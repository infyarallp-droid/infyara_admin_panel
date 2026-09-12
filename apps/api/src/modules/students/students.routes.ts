import { Router } from 'express';
import { z } from 'zod';
import { studentSchema } from '@moksha/shared';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, HttpError } from '../../lib/http.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';

export const studentsRouter = Router();
studentsRouter.use(requireAuth);

const toDate = (s?: string) => (s ? new Date(s) : null);

function toModel(input: z.infer<typeof studentSchema>) {
  return {
    fullName: input.fullName,
    mobile: input.mobile,
    email: input.email || null,
    dob: toDate(input.dob),
    gender: input.gender || null,
    address: input.address || null,
    emergencyContactName: input.emergencyContactName || null,
    emergencyContactPhone: input.emergencyContactPhone || null,
    emergencyContactRelation: input.emergencyContactRelation || null,
    isMinor: input.isMinor ?? false,
  };
}

// GET /api/students?search=&page=&pageSize=
studentsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = z
      .object({
        search: z.string().optional(),
        page: z.coerce.number().min(1).default(1),
        pageSize: z.coerce.number().min(1).max(100).default(20),
      })
      .parse(req.query);

    const where = q.search
      ? {
          OR: [
            { fullName: { contains: q.search, mode: 'insensitive' as const } },
            { mobile: { contains: q.search } },
          ],
        }
      : {};

    const [total, items] = await Promise.all([
      prisma.student.count({ where }),
      prisma.student.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    res.json({ ok: true, total, page: q.page, pageSize: q.pageSize, items });
  }),
);

// GET /api/students/:id  (with enrollments + consent forms)
studentsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const student = await prisma.student.findUnique({
      where: { id: req.params.id },
      include: {
        enrollments: {
          include: { coursePlan: { include: { course: true } }, classTiming: true },
          orderBy: { createdAt: 'desc' },
        },
        consentForms: { include: { uploads: true }, orderBy: { createdAt: 'desc' } },
        invoices: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!student) throw new HttpError(404, 'Student not found');
    res.json({ ok: true, student });
  }),
);

// POST /api/students
studentsRouter.post(
  '/',
  requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'FRONT_DESK'),
  asyncHandler(async (req, res) => {
    const input = studentSchema.parse(req.body);
    const existing = await prisma.student.findUnique({ where: { mobile: input.mobile } });
    if (existing) throw new HttpError(409, 'A student with this mobile already exists');
    const student = await prisma.student.create({
      data: { ...toModel(input), createdById: req.user!.sub },
    });
    res.status(201).json({ ok: true, student });
  }),
);

// PUT /api/students/:id
studentsRouter.put(
  '/:id',
  requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'FRONT_DESK'),
  asyncHandler(async (req, res) => {
    const input = studentSchema.parse(req.body);
    const student = await prisma.student.update({
      where: { id: req.params.id },
      data: toModel(input),
    });
    res.json({ ok: true, student });
  }),
);

// DELETE /api/students/:id
studentsRouter.delete(
  '/:id',
  requireRole('SUPER_ADMIN', 'ADMIN'),
  asyncHandler(async (req, res) => {
    await prisma.student.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  }),
);
