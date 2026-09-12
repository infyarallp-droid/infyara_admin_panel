import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, HttpError } from '../../lib/http.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';

export const coursesRouter = Router();
coursesRouter.use(requireAuth);

const manage = requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER');

const durationType = z.enum(['MONTH_1', 'MONTH_3', 'MONTH_12', 'HRS_200', 'HRS_300', 'HRS_600', 'CUSTOM']);

// ───────────── Courses ─────────────

coursesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { category } = z.object({ category: z.enum(['REGULAR', 'TEACHER_TRAINING']).optional() }).parse(req.query);
    const courses = await prisma.course.findMany({
      where: category ? { category } : {},
      include: {
        plans: { orderBy: { pricePaise: 'asc' } },
        timings: { where: { isActive: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ ok: true, courses });
  }),
);

const courseSchema = z.object({
  name: z.string().min(2),
  category: z.enum(['REGULAR', 'TEACHER_TRAINING']),
  discipline: z.enum(['YOGA', 'PILATES', 'DANCE']).optional(),
  description: z.string().optional(),
});

coursesRouter.post(
  '/',
  manage,
  asyncHandler(async (req, res) => {
    const input = courseSchema.parse(req.body);
    const course = await prisma.course.create({ data: input });
    res.status(201).json({ ok: true, course });
  }),
);

coursesRouter.put(
  '/:id',
  manage,
  asyncHandler(async (req, res) => {
    const input = courseSchema.partial().parse(req.body);
    const course = await prisma.course.update({ where: { id: req.params.id }, data: input });
    res.json({ ok: true, course });
  }),
);

// ───────────── Plans ─────────────

const planSchema = z.object({
  title: z.string().min(1),
  durationType,
  durationValue: z.number().int().positive().optional(),
  priceRupees: z.number().nonnegative(),
  sessionsPerWeek: z.number().int().positive().optional(),
});

coursesRouter.post(
  '/:courseId/plans',
  manage,
  asyncHandler(async (req, res) => {
    const input = planSchema.parse(req.body);
    const plan = await prisma.coursePlan.create({
      data: {
        courseId: req.params.courseId,
        title: input.title,
        durationType: input.durationType,
        durationValue: input.durationValue,
        pricePaise: BigInt(Math.round(input.priceRupees * 100)),
        sessionsPerWeek: input.sessionsPerWeek,
      },
    });
    res.status(201).json({ ok: true, plan });
  }),
);

coursesRouter.put(
  '/plans/:id',
  manage,
  asyncHandler(async (req, res) => {
    const input = planSchema.partial().parse(req.body);
    const plan = await prisma.coursePlan.update({
      where: { id: req.params.id },
      data: {
        title: input.title,
        durationType: input.durationType,
        durationValue: input.durationValue,
        sessionsPerWeek: input.sessionsPerWeek,
        ...(input.priceRupees != null ? { pricePaise: BigInt(Math.round(input.priceRupees * 100)) } : {}),
      },
    });
    res.json({ ok: true, plan });
  }),
);

coursesRouter.delete(
  '/plans/:id',
  manage,
  asyncHandler(async (req, res) => {
    await prisma.coursePlan.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  }),
);

// ───────────── Class timings ─────────────

const timingSchema = z.object({
  courseId: z.string().uuid().optional(),
  label: z.string().min(1),
  days: z.array(z.string()).optional(),
  trainerId: z.string().uuid().optional(),
  capacity: z.number().int().positive().optional(),
});

coursesRouter.get(
  '/timings/all',
  asyncHandler(async (_req, res) => {
    const timings = await prisma.classTiming.findMany({
      where: { isActive: true },
      include: { course: true },
      orderBy: { label: 'asc' },
    });
    res.json({ ok: true, timings });
  }),
);

coursesRouter.post(
  '/timings',
  manage,
  asyncHandler(async (req, res) => {
    const input = timingSchema.parse(req.body);
    const timing = await prisma.classTiming.create({ data: input });
    res.status(201).json({ ok: true, timing });
  }),
);

coursesRouter.put(
  '/timings/:id',
  manage,
  asyncHandler(async (req, res) => {
    const input = timingSchema.partial().parse(req.body);
    const timing = await prisma.classTiming.update({ where: { id: req.params.id }, data: input });
    res.json({ ok: true, timing });
  }),
);

coursesRouter.delete(
  '/timings/:id',
  manage,
  asyncHandler(async (req, res) => {
    await prisma.classTiming.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ ok: true });
  }),
);

// Helper reused by enrollments: days a plan runs for.
export function daysForDuration(durationType: string, durationValue?: number | null): number {
  switch (durationType) {
    case 'MONTH_1':
      return 30;
    case 'MONTH_3':
      return 90;
    case 'MONTH_12':
      return 365;
    case 'HRS_200':
      return 60;
    case 'HRS_300':
      return 90;
    case 'HRS_600':
      return 180;
    default:
      return durationValue ?? 30;
  }
}
