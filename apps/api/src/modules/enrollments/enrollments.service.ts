import { computeEnrollmentStatus, diffDaysISO, type EnrollmentDisplayStatus } from '@moksha/shared';
import type { Tx } from '../../lib/counters.js';
import { HttpError } from '../../lib/http.js';
import { addDaysISO, dateOnly, statusRules, today, toISODate } from '../../lib/dates.js';
import { summarizePayment } from '../billing/billing.service.js';
import { daysForDuration } from '../courses/courses.routes.js';

/** Invoice fields needed to derive an enrolment's payment position. */
export const invoiceSummarySelect = {
  id: true,
  invoiceNo: true,
  totalPaise: true,
  amountPaidPaise: true,
  status: true,
} as const;

export const enrollInclude = {
  student: true,
  coursePlan: { include: { course: true } },
  classTiming: true,
  invoices: { select: invoiceSummarySelect, orderBy: { createdAt: 'asc' } },
  renewal: { select: { id: true, startDate: true } },
} as const;

interface PresentableEnrollment {
  status: string;
  startDate: Date;
  endDate: Date;
  coursePlan?: { durationType: string; durationValue: number | null } | null;
  invoices?: { id: string; invoiceNo: string; totalPaise: bigint; amountPaidPaise: bigint; status: string }[];
  renewal?: { startDate: Date } | null;
}

/** Add the computed (date + payment derived) status and fee position to an enrolment row. */
export function presentEnrollment<T extends PresentableEnrollment>(e: T, todayStr: string = today()) {
  const payment = summarizePayment(e.invoices);
  const computed = computeEnrollmentStatus(
    {
      status: e.status,
      startDate: e.startDate,
      endDate: e.endDate,
      paymentStatus: payment.status,
      renewalStartDate: e.renewal?.startDate ?? null,
    },
    todayStr,
    statusRules(),
  );
  return {
    ...e,
    displayStatus: computed.status as EnrollmentDisplayStatus,
    statusReason: computed.reason,
    daysRemaining: computed.daysRemaining,
    durationDays: e.coursePlan ? daysForDuration(e.coursePlan.durationType, e.coursePlan.durationValue) : null,
    payment,
  };
}

/** End date for a period: start + plan length in days (the convention the app has always used). */
export function periodEnd(startISO: string, plan: { durationType: string; durationValue: number | null }): string {
  return addDaysISO(startISO, daysForDuration(plan.durationType, plan.durationValue));
}

export function assertPeriod(startISO: string, endISO: string) {
  if (startISO > endISO) throw new HttpError(400, 'Start date cannot be later than the end date');
  if (diffDaysISO(endISO, startISO) > 366 * 5) throw new HttpError(400, 'Enrolment period is unreasonably long');
}

/**
 * Lock the student row for the rest of the transaction. Every enrol/renew for a
 * student goes through this, so two simultaneous submissions are processed one
 * after the other and the second one sees the first one's enrolment.
 */
export async function lockStudent(tx: Tx, studentId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "students" WHERE "id" = ${studentId}::uuid FOR UPDATE`;
  if (!rows.length) throw new HttpError(404, 'Student not found');
}

/**
 * Another live enrolment of the same student in the same course whose period
 * overlaps [start, end]. Closed (renewed) and cancelled periods never conflict.
 */
export async function findOverlappingEnrollment(
  tx: Tx,
  args: { studentId: string; courseId: string; startISO: string; endISO: string; excludeId?: string },
) {
  return tx.enrollment.findFirst({
    where: {
      studentId: args.studentId,
      coursePlan: { courseId: args.courseId },
      status: { notIn: ['CANCELLED', 'COMPLETED'] },
      startDate: { lte: dateOnly(args.endISO) },
      endDate: { gte: dateOnly(args.startISO) },
      ...(args.excludeId ? { id: { not: args.excludeId } } : {}),
    },
    include: { coursePlan: { include: { course: true } } },
    orderBy: { startDate: 'asc' },
  });
}

export function overlapMessage(e: { startDate: Date; endDate: Date; coursePlan: { title: string; course: { name: string } } }) {
  return `Student is already enrolled in ${e.coursePlan.course.name} (${e.coursePlan.title}) from ${toISODate(e.startDate)} to ${toISODate(e.endDate)}, which overlaps this period`;
}
