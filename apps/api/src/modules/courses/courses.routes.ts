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
    const { category, active } = z
      .object({
        category: z.enum(['REGULAR', 'TEACHER_TRAINING']).optional(),
        // active=true → only courses open for enrolment (used by the enrol form)
        active: z.enum(['true', 'false']).optional(),
      })
      .parse(req.query);
    const courses = await prisma.course.findMany({
      where: { ...(category ? { category } : {}), ...(active ? { isActive: active === 'true' } : {}) },
      include: {
        plans: { where: { isActive: true }, orderBy: { pricePaise: 'asc' } },
        timings: { where: { isActive: true } },
      },
      orderBy: [{ category: 'desc' }, { name: 'asc' }],
    });
    res.json({
      ok: true,
      // setupPending lists what the business still has to configure before the
      // course can take enrolments (nothing is invented on its behalf).
      courses: courses.map((c) => ({
        ...c,
        // Length of each plan in days — the single source the UI uses for end-date previews.
        plans: c.plans.map((p) => ({ ...p, durationDays: daysForDuration(p.durationType, p.durationValue) })),
        setupPending: [
          ...(c.plans.length ? [] : ['plan, duration and fee']),
          ...(c.deliveryMode ? [] : ['delivery mode']),
          ...(c.timings.length ? [] : ['timetable']),
        ],
      })),
    });
  }),
);

const courseSchema = z.object({
  name: z.string().trim().min(2),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{1,29}$/, 'Code: 2–30 letters, digits or dashes')
    .optional(),
  category: z.enum(['REGULAR', 'TEACHER_TRAINING']),
  discipline: z.enum(['YOGA', 'PILATES', 'DANCE']).optional(),
  deliveryMode: z.enum(['OFFLINE', 'ONLINE', 'HYBRID']).nullable().optional(),
  description: z.string().trim().max(2000).optional(),
  isActive: z.boolean().optional(),
});

/** A course name must be unique (case-insensitive) so the catalogue never shows the same course twice. */
async function assertUniqueCourse(name: string | undefined, code: string | undefined, exceptId?: string) {
  if (name) {
    const clash = await prisma.course.findFirst({
      where: { name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    if (clash) throw new HttpError(409, `A course named "${clash.name}" already exists`);
  }
  if (code) {
    const clash = await prisma.course.findFirst({ where: { code, ...(exceptId ? { id: { not: exceptId } } : {}) } });
    if (clash) throw new HttpError(409, `Course code ${code} is already used by "${clash.name}"`);
  }
}

coursesRouter.post(
  '/',
  manage,
  asyncHandler(async (req, res) => {
    const input = courseSchema.parse(req.body);
    await assertUniqueCourse(input.name, input.code);
    const course = await prisma.course.create({ data: input });
    res.status(201).json({ ok: true, course });
  }),
);

coursesRouter.put(
  '/:id',
  manage,
  asyncHandler(async (req, res) => {
    const input = courseSchema.partial().parse(req.body);
    await assertUniqueCourse(input.name, input.code, req.params.id);
    const course = await prisma.course.update({ where: { id: req.params.id }, data: input });
    res.json({ ok: true, course });
  }),
);

// ───────────── Plans ─────────────

const planSchema = z.object({
  title: z.string().trim().min(1),
  durationType,
  // For CUSTOM plans this is the length in days.
  durationValue: z.number().int().positive().max(3650).optional(),
  priceRupees: z.number().nonnegative(),
  sessionsPerWeek: z.number().int().positive().optional(),
});

coursesRouter.post(
  '/:courseId/plans',
  manage,
  asyncHandler(async (req, res) => {
    const input = planSchema.parse(req.body);
    if (input.durationType === 'CUSTOM' && !input.durationValue) {
      throw new HttpError(400, 'A custom plan needs its duration in days');
    }
    const course = await prisma.course.findUnique({ where: { id: req.params.courseId }, include: { plans: true } });
    if (!course) throw new HttpError(404, 'Course not found');
    if (course.plans.some((p) => p.isActive && p.title.trim().toLowerCase() === input.title.toLowerCase())) {
      throw new HttpError(409, `This course already has a plan called "${input.title}"`);
    }
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
    const used = await prisma.enrollment.count({ where: { coursePlanId: req.params.id } });
    if (used) {
      // Enrolments reference this plan — retire it (hidden from new enrolments) and keep the history.
      await prisma.coursePlan.update({ where: { id: req.params.id }, data: { isActive: false } });
      return res.json({ ok: true, retired: true });
    }
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
