import { Router } from 'express';
import { z } from 'zod';
import { computeStudentStatus, normalizeMobile, studentSchema } from '@moksha/shared';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, HttpError } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import { nextStudentCode } from '../../lib/counters.js';
import { dateOnly, requireISODate, today, toISODate } from '../../lib/dates.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { invoiceSummarySelect, presentEnrollment } from '../enrollments/enrollments.service.js';
import { studentImportRouter } from './students.import.routes.js';

export const studentsRouter = Router();
studentsRouter.use(requireAuth);

const manage = requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'FRONT_DESK');
const idParam = (value: string) => {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw new HttpError(400, 'Invalid student id');
  return parsed.data;
};

function toModel(input: z.infer<typeof studentSchema>) {
  let dob: Date | null = null;
  if (input.dob) {
    const iso = requireISODate(input.dob, 'Date of birth');
    if (iso > today()) throw new HttpError(400, 'Date of birth cannot be in the future');
    dob = dateOnly(iso);
  }
  return {
    fullName: input.fullName,
    mobile: input.mobile,
    email: input.email ? input.email.toLowerCase() : null,
    dob,
    gender: input.gender || null,
    address: input.address || null,
    emergencyContactName: input.emergencyContactName || null,
    emergencyContactPhone: input.emergencyContactPhone || null,
    emergencyContactRelation: input.emergencyContactRelation || null,
    isMinor: input.isMinor ?? false,
  };
}

const enrollmentForStatus = {
  include: {
    coursePlan: { include: { course: true } },
    classTiming: true,
    invoices: { select: invoiceSummarySelect, orderBy: { createdAt: 'asc' as const } },
    renewal: { select: { id: true, startDate: true } },
  },
  orderBy: { startDate: 'desc' as const },
};

/** The small identity card returned when a student is matched (no health/consent data). */
const matchCard = (s: { id: string; studentCode: string | null; fullName: string; mobile: string; email: string | null; status: string }) => ({
  id: s.id,
  studentCode: s.studentCode,
  fullName: s.fullName,
  mobile: s.mobile,
  email: s.email,
  status: s.status,
});

// Legacy bulk import lives under /api/students/import/* (registered before "/:id").
studentsRouter.use('/import', studentImportRouter);

// GET /api/students?search=&page=&pageSize=
// Each row carries the joining date (first enrolment start) and the computed status + reason.
studentsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = z
      .object({
        search: z.string().trim().optional(),
        page: z.coerce.number().min(1).default(1),
        pageSize: z.coerce.number().min(1).max(100).default(20),
      })
      .parse(req.query);

    const where = q.search
      ? {
          OR: [
            { fullName: { contains: q.search, mode: 'insensitive' as const } },
            { mobile: { contains: q.search } },
            { email: { contains: q.search, mode: 'insensitive' as const } },
            { studentCode: { contains: q.search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [total, rows] = await Promise.all([
      prisma.student.count({ where }),
      prisma.student.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { enrollments: enrollmentForStatus },
      }),
    ]);

    const todayStr = today();
    const items = rows.map(({ enrollments, ...s }) => {
      const presented = enrollments.map((e) => presentEnrollment(e, todayStr));
      const counted = presented.filter((e) => e.displayStatus !== 'CANCELLED');
      const computed = computeStudentStatus(s, counted.map((e) => ({ status: e.displayStatus, endDate: e.endDate })));
      const joiningDate = counted.length ? counted.map((e) => toISODate(e.startDate)).sort()[0] : null;
      const current = presented.filter((e) => ['ACTIVE', 'RENEWAL_DUE', 'PENDING_PAYMENT', 'UPCOMING'].includes(e.displayStatus));
      return {
        ...s,
        joiningDate,
        computedStatus: computed.status,
        statusReason: computed.reason,
        statusManual: computed.manual,
        enrollmentCount: counted.length,
        currentCourses: current.map((e) => `${e.coursePlan.course.name} — ${e.coursePlan.title}`),
      };
    });
    res.json({ ok: true, total, page: q.page, pageSize: q.pageSize, items });
  }),
);

// GET /api/students/match?mobile=&email=
// Used while typing a new student: shows the existing record instead of creating a duplicate.
studentsRouter.get(
  '/match',
  asyncHandler(async (req, res) => {
    const q = z.object({ mobile: z.string().optional(), email: z.string().optional() }).parse(req.query);
    const mobile = q.mobile ? normalizeMobile(q.mobile) : null;
    const email = q.email?.trim().toLowerCase() || null;
    if (!mobile && !email) return res.json({ ok: true, matches: [] });

    const students = await prisma.student.findMany({
      where: {
        OR: [
          ...(mobile ? [{ mobile }] : []),
          ...(email ? [{ email: { equals: email, mode: 'insensitive' as const } }] : []),
        ],
      },
      take: 10,
      orderBy: { createdAt: 'asc' },
    });
    res.json({
      ok: true,
      matches: students.map((s) => ({
        ...matchCard(s),
        matchedOn: [
          ...(mobile && s.mobile === mobile ? ['mobile'] : []),
          ...(email && s.email?.toLowerCase() === email ? ['email'] : []),
        ],
      })),
    });
  }),
);

// GET /api/students/:id  (with enrollments + consent forms)
studentsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const student = await prisma.student.findUnique({
      where: { id: idParam(req.params.id) },
      include: {
        enrollments: enrollmentForStatus,
        consentForms: { include: { uploads: true }, orderBy: { createdAt: 'desc' } },
        invoices: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!student) throw new HttpError(404, 'Student not found');

    const todayStr = today();
    const enrollments = student.enrollments.map((e) => presentEnrollment(e, todayStr));
    const counted = enrollments.filter((e) => e.displayStatus !== 'CANCELLED');
    const computed = computeStudentStatus(student, counted.map((e) => ({ status: e.displayStatus, endDate: e.endDate })));
    res.json({
      ok: true,
      student: {
        ...student,
        enrollments,
        // Signature images are large and only needed on the consent screen itself.
        consentForms: student.consentForms.map(({ studentSignatureUrl, guardianSignatureUrl, ...c }) => ({
          ...c,
          hasStudentSignature: !!studentSignatureUrl,
          hasGuardianSignature: !!guardianSignatureUrl,
        })),
        joiningDate: counted.length ? counted.map((e) => toISODate(e.startDate)).sort()[0] : null,
        computedStatus: computed.status,
        statusReason: computed.reason,
        statusManual: computed.manual,
        statusEffectiveDate: computed.effectiveDate,
      },
    });
  }),
);

// POST /api/students
// One master record per person: an existing mobile is never duplicated, and a
// matching email is surfaced so the admin can pick the existing student instead.
studentsRouter.post(
  '/',
  manage,
  asyncHandler(async (req, res) => {
    const input = studentSchema.extend({ confirmDifferentPerson: z.boolean().default(false) }).parse(req.body);
    const data = toModel(input);

    const byMobile = await prisma.student.findUnique({ where: { mobile: data.mobile } });
    if (byMobile) {
      throw new HttpError(409, 'A student with this mobile already exists — open that student to add another enrolment', {
        code: 'STUDENT_EXISTS',
        existing: matchCard(byMobile),
      });
    }
    if (data.email && !input.confirmDifferentPerson) {
      const byEmail = await prisma.student.findFirst({ where: { email: { equals: data.email, mode: 'insensitive' } } });
      if (byEmail) {
        throw new HttpError(
          409,
          'A student with this email already exists. Use the existing student, or confirm this is a different person.',
          { code: 'POSSIBLE_DUPLICATE', existing: matchCard(byEmail) },
        );
      }
    }

    // The unique mobile constraint is the final guard if two admins save at the same moment.
    const student = await prisma.$transaction(async (tx) =>
      tx.student.create({ data: { ...data, studentCode: await nextStudentCode(tx), createdById: req.user!.sub } }),
    );
    res.status(201).json({ ok: true, student });
  }),
);

// PUT /api/students/:id
studentsRouter.put(
  '/:id',
  manage,
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const data = toModel(studentSchema.parse(req.body));
    const clash = await prisma.student.findFirst({ where: { mobile: data.mobile, id: { not: id } } });
    if (clash) {
      throw new HttpError(409, 'Another student already uses this mobile number', {
        code: 'STUDENT_EXISTS',
        existing: matchCard(clash),
      });
    }
    const student = await prisma.student.update({ where: { id }, data });
    res.json({ ok: true, student });
  }),
);

// POST /api/students/:id/deactivate — manual deactivation with reason, effective date and audit trail.
studentsRouter.post(
  '/:id/deactivate',
  requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const input = z
      .object({
        reason: z.string().trim().min(5, 'Give a reason of at least 5 characters').max(300),
        effectiveDate: z.string().optional(),
      })
      .parse(req.body);
    const todayStr = today();
    const effective = input.effectiveDate ? requireISODate(input.effectiveDate, 'Effective date') : todayStr;
    if (effective > todayStr) throw new HttpError(400, 'Effective date cannot be in the future');

    const student = await prisma.$transaction(async (tx) => {
      const current = await tx.student.findUnique({ where: { id } });
      if (!current) throw new HttpError(404, 'Student not found');
      if (current.status === 'INACTIVE') throw new HttpError(409, 'Student is already deactivated');
      const updated = await tx.student.update({
        where: { id },
        data: {
          status: 'INACTIVE',
          deactivationReason: input.reason,
          deactivationEffectiveDate: dateOnly(effective),
          deactivatedAt: new Date(),
          deactivatedById: req.user!.sub,
        },
      });
      await audit(tx, {
        userId: req.user!.sub,
        action: 'STUDENT_DEACTIVATED',
        entity: 'student',
        entityId: id,
        meta: { reason: input.reason, effectiveDate: effective },
      });
      return updated;
    });
    res.json({ ok: true, student });
  }),
);

// POST /api/students/:id/reactivate
studentsRouter.post(
  '/:id/reactivate',
  requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const input = z.object({ reason: z.string().trim().max(300).optional() }).parse(req.body ?? {});
    const student = await prisma.$transaction(async (tx) => {
      const current = await tx.student.findUnique({ where: { id } });
      if (!current) throw new HttpError(404, 'Student not found');
      if (current.status !== 'INACTIVE') throw new HttpError(409, 'Student is not deactivated');
      const updated = await tx.student.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          deactivationReason: null,
          deactivationEffectiveDate: null,
          deactivatedAt: null,
          deactivatedById: null,
        },
      });
      await audit(tx, {
        userId: req.user!.sub,
        action: 'STUDENT_REACTIVATED',
        entity: 'student',
        entityId: id,
        meta: {
          reason: input.reason ?? null,
          previousReason: current.deactivationReason,
          previousEffectiveDate: current.deactivationEffectiveDate ? toISODate(current.deactivationEffectiveDate) : null,
        },
      });
      return updated;
    });
    res.json({ ok: true, student });
  }),
);

// GET /api/students/:id/status-history — the deactivation/reactivation audit trail
studentsRouter.get(
  '/:id/status-history',
  asyncHandler(async (req, res) => {
    const history = await prisma.auditLog.findMany({
      where: { entity: 'student', entityId: idParam(req.params.id) },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ ok: true, history });
  }),
);

// DELETE /api/students/:id
studentsRouter.delete(
  '/:id',
  requireRole('SUPER_ADMIN', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    // Deleting would cascade to enrolments and consent forms — never allow that
    // once the student has any financial or enrolment history. Deactivate instead.
    const [enrollments, invoices] = await Promise.all([
      prisma.enrollment.count({ where: { studentId: id } }),
      prisma.invoice.count({ where: { studentId: id } }),
    ]);
    if (enrollments || invoices) {
      throw new HttpError(409, 'This student has enrolment or billing history and cannot be deleted. Deactivate the student instead.');
    }
    await prisma.student.delete({ where: { id } });
    res.json({ ok: true });
  }),
);
