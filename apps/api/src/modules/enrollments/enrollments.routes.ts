import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../lib/env.js';
import { asyncHandler, HttpError } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import { addDaysISO, dateOnly, reminderOffsets, requireISODate, today, toISODate } from '../../lib/dates.js';
import { isWhatsAppConfigured } from '../../lib/whatsappSend.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { createInvoiceForEnrollment, toPaise } from '../billing/billing.service.js';
import { notifyAdmission } from '../messaging/messaging.service.js';
import {
  assertPeriod,
  enrollInclude,
  findOverlappingEnrollment,
  lockStudent,
  overlapMessage,
  periodEnd,
  presentEnrollment,
} from './enrollments.service.js';

export const enrollmentsRouter = Router();
enrollmentsRouter.use(requireAuth);

const manage = requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'FRONT_DESK');
const OVERRIDE_ROLES = ['SUPER_ADMIN', 'ADMIN'];

const idParam = (value: string) => {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw new HttpError(400, 'Invalid enrollment id');
  return parsed.data;
};

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
    const todayStr = today();
    res.json({ ok: true, enrollments: enrollments.map((e) => presentEnrollment(e, todayStr)) });
  }),
);

/** Start date pre-filled in the renewal dialog, per the configured convention. */
function suggestedRenewalStart(endISO: string, todayStr: string): string {
  return env.RENEWAL_START_DEFAULT === 'DAY_AFTER_EXPIRY' ? addDaysISO(endISO, 1) : todayStr;
}

// GET /api/enrollments/renewals-due?days=30
// Current enrolments ending within the window — including ones already expired and not renewed.
enrollmentsRouter.get(
  '/renewals-due',
  asyncHandler(async (req, res) => {
    const { days } = z.object({ days: z.coerce.number().min(1).max(365).default(30) }).parse(req.query);
    const todayStr = today();
    const until = dateOnly(addDaysISO(todayStr, days));
    const enrollments = await prisma.enrollment.findMany({
      where: { status: 'ACTIVE', endDate: { lte: until } },
      include: enrollInclude,
      orderBy: { endDate: 'asc' },
    });

    // Original joining date = the student's first ever enrolment start.
    const studentIds = [...new Set(enrollments.map((e) => e.studentId))];
    const [firstStarts, logs] = await Promise.all([
      studentIds.length
        ? prisma.enrollment.groupBy({
            by: ['studentId'],
            where: { studentId: { in: studentIds }, status: { not: 'CANCELLED' } },
            _min: { startDate: true },
          })
        : Promise.resolve([]),
      enrollments.length
        ? prisma.messageLog.findMany({
            where: { enrollmentId: { in: enrollments.map((e) => e.id) }, event: 'RENEWAL_REMINDER' },
            orderBy: { createdAt: 'desc' },
          })
        : Promise.resolve([]),
    ]);
    const joined = new Map(firstStarts.map((r) => [r.studentId, r._min.startDate]));
    const lastReminder = new Map<string, (typeof logs)[number]>();
    for (const log of logs) if (log.enrollmentId && !lastReminder.has(log.enrollmentId)) lastReminder.set(log.enrollmentId, log);

    res.json({
      ok: true,
      until,
      today: todayStr,
      config: {
        renewalStartDefault: env.RENEWAL_START_DEFAULT,
        reminderDays: reminderOffsets(),
        whatsappConfigured: isWhatsAppConfigured(),
      },
      enrollments: enrollments.map((e) => {
        const p = presentEnrollment(e, todayStr);
        const start = suggestedRenewalStart(toISODate(e.endDate), todayStr);
        const reminder = lastReminder.get(e.id);
        return {
          ...p,
          joiningDate: joined.get(e.studentId) ?? e.startDate,
          suggestedRenewalStart: start,
          suggestedNextExpiry: periodEnd(start, e.coursePlan),
          lastReminder: reminder
            ? { status: reminder.status, at: reminder.sentAt ?? reminder.updatedAt, error: reminder.error }
            : null,
        };
      }),
    });
  }),
);

const createSchema = z.object({
  studentId: z.string().uuid(),
  coursePlanId: z.string().uuid(),
  classTimingId: z.string().uuid().optional(),
  startDate: z.string(),
  endDate: z.string().optional(), // optional override
  discountRupees: z.number().nonnegative().default(0),
  notes: z.string().trim().max(500).optional(),
  // Authorised override of the duplicate-enrolment block (needs a reason).
  allowDuplicate: z.boolean().default(false),
  overrideReason: z.string().trim().max(300).optional(),
});

// POST /api/enrollments
enrollmentsRouter.post(
  '/',
  manage,
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    const plan = await prisma.coursePlan.findUnique({ where: { id: input.coursePlanId }, include: { course: true } });
    if (!plan) throw new HttpError(404, 'Course plan not found');
    if (!plan.isActive || !plan.course.isActive) throw new HttpError(409, 'This course/plan is not open for enrolment');

    const startISO = requireISODate(input.startDate, 'Start date');
    const endISO = input.endDate ? requireISODate(input.endDate, 'End date') : periodEnd(startISO, plan);
    assertPeriod(startISO, endISO);

    const discount = toPaise(input.discountRupees, 'Discount');
    if (discount > plan.pricePaise) throw new HttpError(400, 'Discount cannot exceed the plan fee');

    if (input.classTimingId) {
      const timing = await prisma.classTiming.findUnique({ where: { id: input.classTimingId } });
      if (!timing || !timing.isActive) throw new HttpError(404, 'Class timing not found');
      if (timing.courseId && timing.courseId !== plan.courseId) {
        throw new HttpError(400, 'That class timing belongs to a different course');
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      await lockStudent(tx, input.studentId);
      const student = await tx.student.findUniqueOrThrow({ where: { id: input.studentId } });
      if (student.status === 'INACTIVE') {
        throw new HttpError(409, 'This student is deactivated. Reactivate the student before adding an enrolment.');
      }

      const clash = await findOverlappingEnrollment(tx, {
        studentId: input.studentId,
        courseId: plan.courseId,
        startISO,
        endISO,
      });
      let overridden = false;
      if (clash) {
        const mayOverride = env.DUPLICATE_ENROLLMENT_OVERRIDE && OVERRIDE_ROLES.includes(req.user!.role);
        if (!input.allowDuplicate || !mayOverride) {
          throw new HttpError(409, overlapMessage(clash), {
            code: 'DUPLICATE_ENROLLMENT',
            existingEnrollmentId: clash.id,
            canOverride: mayOverride,
          });
        }
        if (!input.overrideReason || input.overrideReason.length < 5) {
          throw new HttpError(400, 'A reason is required to override the duplicate-enrolment check');
        }
        overridden = true;
      }

      const enrollment = await tx.enrollment.create({
        data: {
          studentId: input.studentId,
          coursePlanId: input.coursePlanId,
          classTimingId: input.classTimingId,
          startDate: dateOnly(startISO),
          endDate: dateOnly(endISO),
          pricePaise: plan.pricePaise,
          discountPaise: discount,
          notes: overridden ? `Duplicate override: ${input.overrideReason}` : input.notes ?? null,
          createdById: req.user!.sub,
        },
      });
      const invoice = await createInvoiceForEnrollment(tx, enrollment.id, 'ENROLLMENT', req.user!.sub);
      if (overridden) {
        await audit(tx, {
          userId: req.user!.sub,
          action: 'ENROLLMENT_DUPLICATE_OVERRIDE',
          entity: 'enrollment',
          entityId: enrollment.id,
          meta: { reason: input.overrideReason, overlapsEnrollmentId: clash!.id },
        });
      }
      const full = await tx.enrollment.findUniqueOrThrow({ where: { id: enrollment.id }, include: enrollInclude });
      return { enrollment: presentEnrollment(full), invoice, student };
    });

    notifyAdmission({
      enrollmentId: result.enrollment.id,
      studentId: result.student.id,
      studentName: result.student.fullName,
      mobile: result.student.mobile,
      courseLabel: `${plan.course.name} (${plan.title})`,
      startDate: startISO,
    }).catch((e) => console.error('[enrollments] admission WhatsApp failed', e));

    res.status(201).json({ ok: true, enrollment: result.enrollment, invoice: result.invoice });
  }),
);

// POST /api/enrollments/:id/renew  → new enrollment linked to the old one.
// The original period is kept untouched (closed as COMPLETED); every renewal is
// its own record with its own start date, fee, discount and invoice.
enrollmentsRouter.post(
  '/:id/renew',
  manage,
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const input = z
      .object({
        startDate: z.string().optional(),
        coursePlanId: z.string().uuid().optional(), // switch plan within the same course
        classTimingId: z.string().uuid().optional(),
        discountRupees: z.number().nonnegative().default(0),
        notes: z.string().trim().max(500).optional(),
      })
      .parse(req.body ?? {});

    const found = await prisma.enrollment.findUnique({ where: { id }, select: { studentId: true } });
    if (!found) throw new HttpError(404, 'Enrollment not found');

    const result = await prisma.$transaction(async (tx) => {
      await lockStudent(tx, found.studentId);
      // Re-read under the lock: a concurrent/retried renewal has already committed by now.
      const old = await tx.enrollment.findUniqueOrThrow({
        where: { id },
        include: { coursePlan: { include: { course: true } }, renewal: true, student: true },
      });
      if (old.renewal || old.status === 'COMPLETED') {
        throw new HttpError(409, 'This enrolment has already been renewed', {
          code: 'ALREADY_RENEWED',
          renewalEnrollmentId: old.renewal?.id ?? null,
        });
      }
      if (old.status === 'CANCELLED') throw new HttpError(409, 'A cancelled enrolment cannot be renewed');
      if (old.student.status === 'INACTIVE') {
        throw new HttpError(409, 'This student is deactivated. Reactivate the student before renewing.');
      }

      let plan = old.coursePlan;
      if (input.coursePlanId && input.coursePlanId !== old.coursePlanId) {
        const next = await tx.coursePlan.findUnique({ where: { id: input.coursePlanId }, include: { course: true } });
        if (!next || !next.isActive) throw new HttpError(404, 'Course plan not found');
        if (next.courseId !== old.coursePlan.courseId) {
          throw new HttpError(400, 'A renewal must stay in the same course — create a new enrolment for a different course');
        }
        plan = next;
      }

      const todayStr = today();
      const previousExpiry = toISODate(old.endDate);
      const startISO = input.startDate
        ? requireISODate(input.startDate, 'Renewal start date')
        : env.RENEWAL_START_DEFAULT === 'DAY_AFTER_EXPIRY'
          ? addDaysISO(previousExpiry, 1)
          : todayStr;
      if (startISO < toISODate(old.startDate)) {
        throw new HttpError(400, 'Renewal start date cannot be before the start of the period being renewed');
      }
      const endISO = periodEnd(startISO, plan);
      assertPeriod(startISO, endISO);

      const discount = toPaise(input.discountRupees, 'Discount');
      if (discount > plan.pricePaise) throw new HttpError(400, 'Discount cannot exceed the plan fee');

      const clash = await findOverlappingEnrollment(tx, {
        studentId: old.studentId,
        courseId: plan.courseId,
        startISO,
        endISO,
        excludeId: old.id,
      });
      if (clash) throw new HttpError(409, overlapMessage(clash), { code: 'DUPLICATE_ENROLLMENT' });

      const renewal = await tx.enrollment.create({
        data: {
          studentId: old.studentId,
          coursePlanId: plan.id,
          classTimingId: input.classTimingId ?? old.classTimingId,
          startDate: dateOnly(startISO),
          endDate: dateOnly(endISO),
          pricePaise: plan.pricePaise,
          discountPaise: discount,
          parentEnrollmentId: old.id,
          notes: input.notes ?? null,
          createdById: req.user!.sub,
        },
      });
      await tx.enrollment.update({ where: { id: old.id }, data: { status: 'COMPLETED' } });
      const invoice = await createInvoiceForEnrollment(tx, renewal.id, 'RENEWAL', req.user!.sub);
      const full = await tx.enrollment.findUniqueOrThrow({ where: { id: renewal.id }, include: enrollInclude });
      return {
        enrollment: presentEnrollment(full, todayStr),
        invoice,
        renewal: { previousExpiry, renewalStart: startISO, nextExpiry: endISO, renewedFromEnrollmentId: old.id },
      };
    });

    res.status(201).json({ ok: true, ...result });
  }),
);

// GET /api/enrollments/:id — with the full renewal chain (original joining → every renewal)
enrollmentsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const enrollment = await prisma.enrollment.findUnique({
      where: { id },
      include: { ...enrollInclude, parentEnrollment: true },
    });
    if (!enrollment) throw new HttpError(404, 'Enrollment not found');

    const todayStr = today();
    const historyInclude = {
      coursePlan: { include: { course: true } },
      invoices: enrollInclude.invoices,
      renewal: enrollInclude.renewal,
    } as const;
    // Walk back to the original enrolment, then forward through every renewal.
    let root = await prisma.enrollment.findUniqueOrThrow({ where: { id }, include: historyInclude });
    for (let i = 0; i < 200 && root.parentEnrollmentId; i++) {
      const parent = await prisma.enrollment.findUnique({ where: { id: root.parentEnrollmentId }, include: historyInclude });
      if (!parent) break;
      root = parent;
    }
    const history = [presentEnrollment(root, todayStr)];
    for (let i = 0; i < 200; i++) {
      const next = await prisma.enrollment.findUnique({
        where: { parentEnrollmentId: history[history.length - 1].id },
        include: historyInclude,
      });
      if (!next) break;
      history.push(presentEnrollment(next, todayStr));
    }

    res.json({
      ok: true,
      enrollment: { ...presentEnrollment(enrollment, todayStr), renewals: enrollment.renewal ? [enrollment.renewal] : [] },
      originalJoiningDate: root.startDate,
      history,
    });
  }),
);
