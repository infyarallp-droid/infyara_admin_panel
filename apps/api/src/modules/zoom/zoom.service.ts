import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { dateOnly, today } from '../../lib/dates.js';
import { enrollInclude, presentEnrollment } from '../enrollments/enrollments.service.js';

// Who may see a Zoom class: a student whose enrolment in the course is current —
// active, about to be renewed, or starting soon. An enrolment still waiting for its
// payment (per the studio's "active requires payment" rule), ended or cancelled does not.

export const ZOOM_VISIBLE_STATUSES = new Set(['ACTIVE', 'RENEWAL_DUE', 'UPCOMING']);

/** Current enrolments (with their computed status) that unlock online classes. */
export async function zoomEligibleEnrollments(where: Prisma.EnrollmentWhereInput) {
  const todayStr = today();
  const rows = await prisma.enrollment.findMany({
    // Cheap pre-filter; the computed status below is the real rule.
    where: { ...where, status: { in: ['ACTIVE', 'COMPLETED'] }, endDate: { gte: dateOnly(todayStr) } },
    include: enrollInclude,
  });
  return rows.map((e) => presentEnrollment(e, todayStr)).filter((e) => ZOOM_VISIBLE_STATUSES.has(e.displayStatus));
}

export interface ZoomTarget {
  courseId: string;
  classTimingId: string | null;
}

/** The class is for this enrolment's course (and batch, when the class is limited to one). */
export const zoomMatches = (z: ZoomTarget, e: { coursePlan: { courseId: string }; classTimingId: string | null }) =>
  z.courseId === e.coursePlan.courseId && (!z.classTimingId || z.classTimingId === e.classTimingId);

/** A one-off session that has finished is no longer shown to students. */
export const zoomFinished = (z: { startsAt: Date | null; durationMinutes: number }, now = new Date()) =>
  !!z.startsAt && z.startsAt.getTime() + z.durationMinutes * 60_000 < now.getTime();

/** Online classes a student can join now or soon, for the website account page. */
export async function zoomClassesForStudent(studentId: string) {
  const enrollments = await zoomEligibleEnrollments({ studentId });
  if (!enrollments.length) return [];
  const classes = await prisma.zoomClass.findMany({
    where: { isActive: true, courseId: { in: [...new Set(enrollments.map((e) => e.coursePlan.courseId))] } },
    include: { course: { select: { name: true } }, classTiming: { select: { label: true } } },
    orderBy: [{ startsAt: { sort: 'asc', nulls: 'first' } }, { startTime: 'asc' }, { title: 'asc' }],
  });
  return classes
    .filter((z) => !zoomFinished(z) && enrollments.some((e) => zoomMatches(z, e)))
    .map((z) => ({
      id: z.id,
      title: z.title,
      course: z.course.name,
      batch: z.classTiming?.label ?? null,
      meetingUrl: z.meetingUrl,
      meetingId: z.meetingId,
      passcode: z.passcode,
      days: z.days,
      startTime: z.startTime,
      startsAt: z.startsAt,
      durationMinutes: z.durationMinutes,
      notes: z.notes,
    }));
}
