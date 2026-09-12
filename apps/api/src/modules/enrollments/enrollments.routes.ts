import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, HttpError } from '../../lib/http.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { daysForDuration } from '../courses/courses.routes.js';
import { createInvoiceForEnrollment } from '../billing/billing.service.js';

export const enrollmentsRouter = Router();
enrollmentsRouter.use(requireAuth);

const manage = requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'FRONT_DESK');

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

const enrollInclude = {
  student: true,
  coursePlan: { include: { course: true } },
  classTiming: true,
} as const;

// GET /api/enrollments?studentId=&status=
enrollmentsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = z
      .object({
        studentId: z.string().uuid().optional(),
        status: z.enum(['ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED']).optional(),
      })
      .parse(req.query);
    const enrollments = await prisma.enrollment.findMany({
      where: { studentId: q.studentId, status: q.status },
      include: enrollInclude,
      orderBy: { createdAt: 'desc' },
    });
    res.json({ ok: true, enrollments });
  }),
);

// GET /api/enrollments/renewals-due?days=30
enrollmentsRouter.get(
  '/renewals-due',
  asyncHandler(async (req, res) => {
    const { days } = z.object({ days: z.coerce.number().min(1).max(365).default(30) }).parse(req.query);
    const until = addDays(new Date(), days);
    const enrollments = await prisma.enrollment.findMany({
      where: { status: 'ACTIVE', endDate: { lte: until } },
      include: enrollInclude,
      orderBy: { endDate: 'asc' },
    });
    res.json({ ok: true, until, enrollments });
  }),
);

const createSchema = z.object({
  studentId: z.string().uuid(),
  coursePlanId: z.string().uuid(),
  classTimingId: z.string().uuid().optional(),
  startDate: z.string(),
  endDate: z.string().optional(), // optional override
  discountRupees: z.number().nonnegative().default(0),
});

// POST /api/enrollments
enrollmentsRouter.post(
  '/',
  manage,
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    const plan = await prisma.coursePlan.findUnique({ where: { id: input.coursePlanId } });
    if (!plan) throw new HttpError(404, 'Course plan not found');

    const start = new Date(input.startDate);
    const end = input.endDate
      ? new Date(input.endDate)
      : addDays(start, daysForDuration(plan.durationType, plan.durationValue));

    const result = await prisma.$transaction(async (tx) => {
      const enrollment = await tx.enrollment.create({
        data: {
          studentId: input.studentId,
          coursePlanId: input.coursePlanId,
          classTimingId: input.classTimingId,
          startDate: start,
          endDate: end,
          pricePaise: plan.pricePaise,
          discountPaise: BigInt(Math.round(input.discountRupees * 100)),
          createdById: req.user!.sub,
        },
        include: enrollInclude,
      });
      const invoice = await createInvoiceForEnrollment(tx, enrollment.id, 'ENROLLMENT', req.user!.sub);
      return { enrollment, invoice };
    });
    res.status(201).json({ ok: true, ...result });
  }),
);

// POST /api/enrollments/:id/renew  → new enrollment linked to the old one
enrollmentsRouter.post(
  '/:id/renew',
  manage,
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        startDate: z.string().optional(),
        classTimingId: z.string().uuid().optional(),
        discountRupees: z.number().nonnegative().default(0),
      })
      .parse(req.body);

    const old = await prisma.enrollment.findUnique({
      where: { id: req.params.id },
      include: { coursePlan: true },
    });
    if (!old) throw new HttpError(404, 'Enrollment not found');

    const start = input.startDate ? new Date(input.startDate) : new Date();
    const end = addDays(start, daysForDuration(old.coursePlan.durationType, old.coursePlan.durationValue));

    const result = await prisma.$transaction(async (tx) => {
      const renewal = await tx.enrollment.create({
        data: {
          studentId: old.studentId,
          coursePlanId: old.coursePlanId,
          classTimingId: input.classTimingId ?? old.classTimingId,
          startDate: start,
          endDate: end,
          pricePaise: old.coursePlan.pricePaise,
          discountPaise: BigInt(Math.round(input.discountRupees * 100)),
          parentEnrollmentId: old.id,
          createdById: req.user!.sub,
        },
        include: enrollInclude,
      });
      await tx.enrollment.update({ where: { id: old.id }, data: { status: 'COMPLETED' } });
      const invoice = await createInvoiceForEnrollment(tx, renewal.id, 'RENEWAL', req.user!.sub);
      return { enrollment: renewal, invoice };
    });

    res.status(201).json({ ok: true, ...result });
  }),
);

enrollmentsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const enrollment = await prisma.enrollment.findUnique({
      where: { id: req.params.id },
      include: { ...enrollInclude, renewals: true, parentEnrollment: true },
    });
    if (!enrollment) throw new HttpError(404, 'Enrollment not found');
    res.json({ ok: true, enrollment });
  }),
);
