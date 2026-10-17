import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, HttpError } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { zoomEligibleEnrollments, zoomFinished, zoomMatches } from './zoom.service.js';

// Admin: online (Zoom) classes per course. Students see a class's link on their website
// account once their enrolment in that course is current — nothing is ever public.
export const zoomRouter = Router();
zoomRouter.use(requireAuth);

const view = requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'FRONT_DESK', 'TRAINER');
const manage = requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER');

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
const optText = (max: number) => z.string().trim().max(max).optional().or(z.literal('')).transform((v) => v || null);

const zoomSchema = z
  .object({
    courseId: z.string().uuid('Choose a course'),
    classTimingId: z.string().uuid().nullable().optional().or(z.literal('')).transform((v) => v || null),
    title: z.string().trim().min(2, 'Add a name for the class').max(120),
    meetingUrl: z
      .string()
      .trim()
      .max(500)
      .url('Paste the full meeting link, e.g. https://us02web.zoom.us/j/…')
      .refine((v) => v.startsWith('https://'), 'The meeting link must start with https://'),
    meetingId: optText(40),
    passcode: optText(40),
    days: z.array(z.enum(DAYS)).max(7).default([]),
    startTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time such as 07:00')
      .optional()
      .or(z.literal(''))
      .transform((v) => v || null),
    startsAt: z.string().datetime({ offset: true }).nullable().optional(),
    durationMinutes: z.number().int().min(10).max(600).default(60),
    notes: optText(1000),
    isActive: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.startsAt) return;
    if (!v.days.length) ctx.addIssue({ code: 'custom', path: ['days'], message: 'Choose the class days, or set a date for a one-off session' });
    if (!v.startTime) ctx.addIssue({ code: 'custom', path: ['startTime'], message: 'Add the start time' });
  });

const uuid = (v: string) => {
  const p = z.string().uuid().safeParse(v);
  if (!p.success) throw new HttpError(404, 'Zoom class not found');
  return p.data;
};
const log = (req: Request, action: string, id: string, meta?: Prisma.InputJsonValue) =>
  audit(prisma, { userId: req.user!.sub, action, entity: 'zoom_class', entityId: id, meta });

async function parse(body: unknown) {
  const v = zoomSchema.parse(body);
  const course = await prisma.course.findUnique({ where: { id: v.courseId }, select: { id: true } });
  if (!course) throw new HttpError(400, 'Course not found', { fields: { courseId: 'Course not found' } });
  if (v.classTimingId) {
    const timing = await prisma.classTiming.findUnique({ where: { id: v.classTimingId }, select: { courseId: true } });
    if (!timing || (timing.courseId && timing.courseId !== v.courseId)) {
      throw new HttpError(400, 'That batch belongs to a different course', { fields: { classTimingId: 'Choose a batch of this course' } });
    }
  }
  // Keep only the fields that apply to the chosen kind of schedule.
  return v.startsAt
    ? { ...v, startsAt: new Date(v.startsAt), days: [], startTime: null }
    : { ...v, startsAt: null, days: DAYS.filter((d) => v.days.includes(d)) };
}

const include = { course: { select: { id: true, name: true } }, classTiming: { select: { id: true, label: true } } } as const;

// GET /api/zoom-classes?courseId= — every class with how many students can currently see it.
zoomRouter.get(
  '/',
  view,
  asyncHandler(async (req, res) => {
    const q = z.object({ courseId: z.string().uuid().optional() }).parse(req.query);
    const classes = await prisma.zoomClass.findMany({
      where: q.courseId ? { courseId: q.courseId } : {},
      include,
      orderBy: [{ course: { name: 'asc' } }, { startsAt: { sort: 'asc', nulls: 'first' } }, { startTime: 'asc' }],
    });
    const enrollments = classes.length
      ? await zoomEligibleEnrollments({ coursePlan: { courseId: { in: [...new Set(classes.map((c) => c.courseId))] } } })
      : [];
    res.json({
      ok: true,
      items: classes.map((c) => ({
        ...c,
        finished: zoomFinished(c),
        studentCount: new Set(enrollments.filter((e) => zoomMatches(c, e)).map((e) => e.studentId)).size,
      })),
    });
  }),
);

// GET /api/zoom-classes/:id/students — the students who see this class on their account.
zoomRouter.get(
  '/:id/students',
  view,
  asyncHandler(async (req, res) => {
    const zc = await prisma.zoomClass.findUnique({ where: { id: uuid(req.params.id) } });
    if (!zc) throw new HttpError(404, 'Zoom class not found');
    const enrollments = (await zoomEligibleEnrollments({ coursePlan: { courseId: zc.courseId } })).filter((e) => zoomMatches(zc, e));
    const accounts = await prisma.customerAccount.findMany({
      where: { studentId: { in: enrollments.map((e) => e.studentId) }, status: 'ACTIVE' },
      select: { studentId: true },
    });
    const withLogin = new Set(accounts.map((a) => a.studentId));
    const seen = new Set<string>();
    const students = enrollments
      .filter((e) => !seen.has(e.studentId) && seen.add(e.studentId))
      .map((e) => ({
        id: e.student.id,
        fullName: e.student.fullName,
        studentCode: e.student.studentCode,
        plan: e.coursePlan.title,
        batch: e.classTiming?.label ?? null,
        status: e.displayStatus,
        endDate: e.endDate,
        hasWebsiteLogin: withLogin.has(e.studentId),
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
    res.json({ ok: true, students });
  }),
);

zoomRouter.post(
  '/',
  manage,
  asyncHandler(async (req, res) => {
    const data = await parse(req.body);
    const item = await prisma.zoomClass.create({ data: { ...data, createdById: req.user!.sub }, include });
    await log(req, 'ZOOM_CLASS_CREATED', item.id, { courseId: item.courseId });
    res.status(201).json({ ok: true, item });
  }),
);

zoomRouter.put(
  '/:id',
  manage,
  asyncHandler(async (req, res) => {
    const id = uuid(req.params.id);
    if (!(await prisma.zoomClass.findUnique({ where: { id }, select: { id: true } }))) throw new HttpError(404, 'Zoom class not found');
    const item = await prisma.zoomClass.update({ where: { id }, data: await parse(req.body), include });
    await log(req, 'ZOOM_CLASS_UPDATED', id);
    res.json({ ok: true, item });
  }),
);

// PATCH /api/zoom-classes/:id/active { isActive } — show or hide it for students.
zoomRouter.patch(
  '/:id/active',
  manage,
  asyncHandler(async (req, res) => {
    const id = uuid(req.params.id);
    const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);
    if (!(await prisma.zoomClass.findUnique({ where: { id }, select: { id: true } }))) throw new HttpError(404, 'Zoom class not found');
    const item = await prisma.zoomClass.update({ where: { id }, data: { isActive }, include });
    await log(req, isActive ? 'ZOOM_CLASS_SHOWN' : 'ZOOM_CLASS_HIDDEN', id);
    res.json({ ok: true, item });
  }),
);

zoomRouter.delete(
  '/:id',
  manage,
  asyncHandler(async (req, res) => {
    const id = uuid(req.params.id);
    const { count } = await prisma.zoomClass.deleteMany({ where: { id } });
    if (!count) throw new HttpError(404, 'Zoom class not found');
    await log(req, 'ZOOM_CLASS_DELETED', id);
    res.json({ ok: true });
  }),
);
