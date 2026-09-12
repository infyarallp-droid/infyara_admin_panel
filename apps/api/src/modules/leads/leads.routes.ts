import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, HttpError } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';

export const leadsRouter = Router();
leadsRouter.use(requireAuth);

// GET /api/leads?source=&status=&search=
leadsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = z
      .object({
        source: z.string().optional(),
        status: z.enum(['NEW', 'CONTACTED', 'FOLLOW_UP', 'CONVERTED', 'LOST']).optional(),
        search: z.string().optional(),
      })
      .parse(req.query);

    const leads = await prisma.lead.findMany({
      where: {
        source: q.source as never,
        status: q.status,
        ...(q.search
          ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { phone: { contains: q.search } }] }
          : {}),
      },
      orderBy: { receivedAt: 'desc' },
      take: 200,
    });
    res.json({ ok: true, leads });
  }),
);

leadsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const lead = await prisma.lead.findUnique({
      where: { id: req.params.id },
      include: { activities: { orderBy: { createdAt: 'desc' } }, interestedCourse: true, convertedStudent: true },
    });
    if (!lead) throw new HttpError(404, 'Lead not found');
    res.json({ ok: true, lead });
  }),
);

leadsRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        status: z.enum(['NEW', 'CONTACTED', 'FOLLOW_UP', 'CONVERTED', 'LOST']).optional(),
        assignedToId: z.string().uuid().nullable().optional(),
        interestedIn: z.string().uuid().nullable().optional(),
      })
      .parse(req.body);
    const lead = await prisma.lead.update({ where: { id: req.params.id }, data: input });
    res.json({ ok: true, lead });
  }),
);

leadsRouter.post(
  '/:id/activities',
  asyncHandler(async (req, res) => {
    const input = z
      .object({ type: z.enum(['NOTE', 'CALL', 'WHATSAPP', 'EMAIL', 'STATUS_CHANGE']), content: z.string().optional() })
      .parse(req.body);
    const activity = await prisma.leadActivity.create({
      data: { leadId: req.params.id, userId: req.user!.sub, type: input.type, content: input.content },
    });
    res.status(201).json({ ok: true, activity });
  }),
);

// Convert a lead into a student.
leadsRouter.post(
  '/:id/convert',
  asyncHandler(async (req, res) => {
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (!lead) throw new HttpError(404, 'Lead not found');
    if (lead.convertedStudentId) throw new HttpError(409, 'Lead already converted');

    const mobile = (req.body?.mobile as string) || lead.phone;
    if (!mobile) throw new HttpError(400, 'A mobile number is required to create a student');

    const existing = await prisma.student.findUnique({ where: { mobile } });
    const student =
      existing ??
      (await prisma.student.create({
        data: {
          fullName: lead.name ?? 'New Student',
          mobile,
          email: lead.email,
          leadId: lead.id,
          createdById: req.user!.sub,
        },
      }));

    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: 'CONVERTED', convertedStudentId: student.id },
    });
    res.status(201).json({ ok: true, student, reusedExisting: !!existing });
  }),
);
