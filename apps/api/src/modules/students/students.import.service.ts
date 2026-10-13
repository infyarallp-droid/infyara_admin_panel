import { z } from 'zod';
import {
  computeEnrollmentStatus,
  normalizeMobile,
  parseFlexibleDate,
  type EnrollmentDisplayStatus,
} from '@moksha/shared';
import { prisma } from '../../lib/prisma.js';
import { parseCsv, toCsv } from '../../lib/csv.js';
import { audit } from '../../lib/audit.js';
import { nextStudentCode } from '../../lib/counters.js';
import { addDaysISO, dateOnly, statusRules, today, toISODate } from '../../lib/dates.js';
import { createInvoiceForEnrollment, recordPaymentTx, statusFor, type PaymentModeInput } from '../billing/billing.service.js';
import { findOverlappingEnrollment, lockStudent, periodEnd } from '../enrollments/enrollments.service.js';

// ───────────── Template definition ─────────────

type ColumnKey =
  | 'studentCode'
  | 'fullName'
  | 'mobile'
  | 'email'
  | 'dob'
  | 'gender'
  | 'address'
  | 'emergencyContactName'
  | 'emergencyContactPhone'
  | 'course'
  | 'joiningDate'
  | 'plan'
  | 'expiryDate'
  | 'fee'
  | 'amountPaid'
  | 'balance'
  | 'paymentStatus'
  | 'status'
  | 'paymentMode';

interface Column {
  key: ColumnKey;
  header: string;
  aliases: string[];
  required?: boolean;
  /** Present in the downloadable template (paymentMode is accepted but optional/extra). */
  inTemplate: boolean;
}

const COLUMNS: Column[] = [
  { key: 'studentCode', header: 'Student ID', aliases: ['studentid', 'studentcode', 'id'], inTemplate: true },
  { key: 'fullName', header: 'Full Name', aliases: ['fullname', 'name', 'studentname'], required: true, inTemplate: true },
  { key: 'mobile', header: 'Mobile Number', aliases: ['mobilenumber', 'mobile', 'phone', 'contactnumber'], required: true, inTemplate: true },
  { key: 'email', header: 'Email', aliases: ['email', 'emailid', 'mailid'], inTemplate: true },
  { key: 'dob', header: 'Date of Birth', aliases: ['dateofbirth', 'dob'], inTemplate: true },
  { key: 'gender', header: 'Gender', aliases: ['gender'], inTemplate: true },
  { key: 'address', header: 'Address', aliases: ['address'], inTemplate: true },
  { key: 'emergencyContactName', header: 'Emergency Contact Name', aliases: ['emergencycontactname', 'emergencycontact'], inTemplate: true },
  { key: 'emergencyContactPhone', header: 'Emergency Contact Number', aliases: ['emergencycontactnumber', 'emergencycontactphone', 'emergencyphone'], inTemplate: true },
  { key: 'course', header: 'Course Name or Code', aliases: ['coursenameorcode', 'coursename', 'coursecode', 'course', 'coursenamecoursecode'], inTemplate: true },
  { key: 'joiningDate', header: 'Joining Date', aliases: ['joiningdate', 'startdate', 'enrolmentstartdate', 'enrollmentstartdate'], inTemplate: true },
  { key: 'plan', header: 'Plan / Duration', aliases: ['planduration', 'plan', 'duration'], inTemplate: true },
  { key: 'expiryDate', header: 'Expiry Date', aliases: ['expirydate', 'enddate'], inTemplate: true },
  { key: 'fee', header: 'Fee', aliases: ['fee', 'fees', 'coursefee'], inTemplate: true },
  { key: 'amountPaid', header: 'Amount Paid', aliases: ['amountpaid', 'paid'], inTemplate: true },
  { key: 'balance', header: 'Balance', aliases: ['balance', 'balancedue'], inTemplate: true },
  { key: 'paymentStatus', header: 'Payment Status', aliases: ['paymentstatus'], inTemplate: true },
  { key: 'status', header: 'Status', aliases: ['status', 'studentstatus', 'enrolmentstatus', 'enrollmentstatus', 'studentenrolmentstatus'], inTemplate: true },
  { key: 'paymentMode', header: 'Payment Mode', aliases: ['paymentmode', 'mode'], inTemplate: false },
];

const ENROLLMENT_KEYS: ColumnKey[] = ['course', 'joiningDate', 'plan', 'expiryDate', 'fee', 'amountPaid', 'balance', 'paymentStatus'];
const MAX_ROWS = 2000;
/**
 * A legacy period that ended longer ago than this is stored as historical
 * (EXPIRED) so it does not flood the Renewals Due list or trigger reminders.
 * More recent expiries stay in the renewal workflow.
 */
const HISTORICAL_AFTER_DAYS = 30;
const normHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The downloadable template: header row only, so nothing can be imported by accident. */
export function importTemplateCsv(): string {
  return toCsv([COLUMNS.filter((c) => c.inTemplate).map((c) => c.header)]);
}

export const importTemplateGuide = {
  required: ['Full Name', 'Mobile Number'],
  enrolment:
    'To import an enrolment fill Course Name or Code, Joining Date and Plan / Duration. Expiry Date, Fee and Amount Paid are optional (calculated from the plan / defaulted to plan fee and 0).',
  dates: 'Dates: YYYY-MM-DD or DD-MM-YYYY (day first).',
  money: 'Amounts: plain numbers in rupees, e.g. 2500 or 2500.50.',
  paymentStatus: 'Payment Status (optional): Paid, Partial or Unpaid — must agree with Fee and Amount Paid.',
  status: 'Status (optional): checked against the status calculated from the dates; the calculated status is what gets used.',
};

// ───────────── Row analysis ─────────────

export type ImportRowStatus = 'NEW_STUDENT' | 'EXISTING_STUDENT' | 'DUPLICATE' | 'INVALID';

interface RowEnrollment {
  courseId: string;
  courseName: string;
  planId: string;
  planTitle: string;
  startISO: string;
  endISO: string;
  feePaise: bigint;
  paidPaise: bigint;
  paymentStatus: 'PAID' | 'PARTIAL' | 'UNPAID';
  paymentMode: PaymentModeInput;
  computedStatus: EnrollmentDisplayStatus;
}

interface RowStudent {
  studentCode: string | null;
  fullName: string;
  mobile: string;
  email: string | null;
  dob: string | null;
  gender: string | null;
  address: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
}

export interface AnalyzedRow {
  rowNumber: number;
  status: ImportRowStatus;
  errors: string[];
  warnings: string[];
  /** What importing this row will do, in words. */
  action: string;
  willImport: boolean;
  student: RowStudent | null;
  matchedStudentId: string | null;
  enrollment: RowEnrollment | null;
}

export interface ImportAnalysis {
  fileErrors: string[];
  rows: AnalyzedRow[];
  summary: {
    totalRows: number;
    importableRows: number;
    newStudents: number;
    existingStudents: number;
    enrollmentsToCreate: number;
    duplicateRows: number;
    invalidRows: number;
  };
}

const emailSchema = z.string().email();
const MONEY = /^\d+(\.\d{1,2})?$/;

function parseMoney(raw: string): bigint | null {
  const v = raw.replace(/[,\s]/g, '').replace(/^(₹|rs\.?|inr)/i, '');
  if (!MONEY.test(v)) return null;
  const [whole, frac = ''] = v.split('.');
  return BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0'));
}

const STATUS_ALIASES: Record<string, EnrollmentDisplayStatus[]> = {
  active: ['ACTIVE', 'RENEWAL_DUE'],
  renewaldue: ['RENEWAL_DUE'],
  due: ['RENEWAL_DUE'],
  upcoming: ['UPCOMING'],
  expired: ['EXPIRED'],
  inactive: ['EXPIRED'],
  pendingpayment: ['PENDING_PAYMENT'],
};

const DURATION_KEYWORDS: [RegExp, string][] = [
  [/^(1|one)\s*months?$|^monthly$/i, 'MONTH_1'],
  [/^(3|three)\s*months?$|^quarterly$/i, 'MONTH_3'],
  [/^(12|twelve)\s*months?$|^(1|one)\s*year$|^yearly$|^annual$/i, 'MONTH_12'],
  [/^200\s*(hrs?|hours?)/i, 'HRS_200'],
  [/^300\s*(hrs?|hours?)/i, 'HRS_300'],
  [/^600\s*(hrs?|hours?)/i, 'HRS_600'],
];

type CourseWithPlans = Awaited<ReturnType<typeof loadCourses>>[number];
const loadCourses = () => prisma.course.findMany({ include: { plans: { where: { isActive: true } } } });

function matchPlan(course: CourseWithPlans, raw: string) {
  const want = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  const byTitle = course.plans.filter((p) => p.title.trim().toLowerCase().replace(/\s+/g, ' ') === want);
  if (byTitle.length === 1) return byTitle[0];
  for (const [re, durationType] of DURATION_KEYWORDS) {
    if (re.test(want)) {
      const byDuration = course.plans.filter((p) => p.durationType === durationType);
      if (byDuration.length === 1) return byDuration[0];
    }
  }
  return null;
}

export class ImportFileError extends Error {}

/** Validate the whole file against the database without writing anything. */
export async function analyzeImport(fileText: string): Promise<ImportAnalysis> {
  let table: string[][];
  try {
    table = parseCsv(fileText);
  } catch (e) {
    throw new ImportFileError((e as Error).message);
  }
  table = table.filter((r) => r.some((c) => c.trim() !== ''));
  if (!table.length) throw new ImportFileError('The file is empty');

  // ── Structure: every header must be a known column, required ones must be present ──
  const headerRow = table[0].map((h) => h.trim());
  const fileErrors: string[] = [];
  const colIndex = new Map<ColumnKey, number>();
  headerRow.forEach((h, i) => {
    if (!h) return;
    const col = COLUMNS.find((c) => c.aliases.includes(normHeader(h)));
    if (!col) fileErrors.push(`Unknown column "${h}" — use the downloaded template headers`);
    else if (colIndex.has(col.key)) fileErrors.push(`Column "${h}" appears more than once`);
    else colIndex.set(col.key, i);
  });
  for (const c of COLUMNS.filter((x) => x.required)) {
    if (!colIndex.has(c.key)) fileErrors.push(`Required column "${c.header}" is missing`);
  }
  const dataRows = table.slice(1);
  if (dataRows.length > MAX_ROWS) fileErrors.push(`Too many rows (${dataRows.length}). Import at most ${MAX_ROWS} rows per file.`);
  if (!dataRows.length && !fileErrors.length) fileErrors.push('The file has a header row but no student rows');
  if (fileErrors.length) {
    return {
      fileErrors,
      rows: [],
      summary: { totalRows: dataRows.length, importableRows: 0, newStudents: 0, existingStudents: 0, enrollmentsToCreate: 0, duplicateRows: 0, invalidRows: 0 },
    };
  }

  const cell = (row: string[], key: ColumnKey) => {
    const i = colIndex.get(key);
    return i == null ? '' : (row[i] ?? '').trim();
  };

  // ── Reference data, loaded once ──
  const todayStr = today();
  const rules = statusRules();
  const courses = await loadCourses();
  const mobiles = [...new Set(dataRows.map((r) => normalizeMobile(cell(r, 'mobile'))).filter((m): m is string => !!m))];
  const codes = [...new Set(dataRows.map((r) => cell(r, 'studentCode')).filter(Boolean))];
  const emails = [...new Set(dataRows.map((r) => cell(r, 'email').toLowerCase()).filter(Boolean))];
  const existing = await prisma.student.findMany({
    where: { OR: [{ mobile: { in: mobiles } }, { studentCode: { in: codes } }, { email: { in: emails } }] },
    include: { enrollments: { include: { coursePlan: true }, where: { status: { notIn: ['CANCELLED', 'COMPLETED'] } } } },
  });
  const byMobile = new Map(existing.map((s) => [s.mobile, s]));
  const byCode = new Map(existing.filter((s) => s.studentCode).map((s) => [s.studentCode!.toLowerCase(), s]));
  const byEmail = new Map(existing.filter((s) => s.email).map((s) => [s.email!.toLowerCase(), s]));

  // ── Within-file tracking (duplicate rows, one identity per mobile) ──
  const seenStudents = new Map<string, { rowNumber: number; name: string }>();
  const seenCodes = new Map<string, string>();
  const seenEnrollments: { mobile: string; courseId: string; startISO: string; endISO: string; rowNumber: number }[] = [];

  const rows: AnalyzedRow[] = dataRows.map((raw, idx) => {
    const rowNumber = idx + 2; // header is line 1
    const errors: string[] = [];
    const warnings: string[] = [];

    // Student fields
    const fullName = cell(raw, 'fullName');
    if (fullName.length < 2) errors.push('Full Name is required');
    const mobileRaw = cell(raw, 'mobile');
    const mobile = normalizeMobile(mobileRaw);
    if (!mobileRaw) errors.push('Mobile Number is required');
    else if (!mobile) {
      errors.push(
        /e\+?\d+/i.test(mobileRaw)
          ? `Mobile Number "${mobileRaw}" was converted to scientific notation by Excel — format the column as Text/Number with no decimals`
          : `Mobile Number "${mobileRaw}" is not a valid 10-digit mobile`,
      );
    }
    const emailRaw = cell(raw, 'email').toLowerCase();
    if (emailRaw && !emailSchema.safeParse(emailRaw).success) errors.push(`Email "${emailRaw}" is not valid`);
    const dobRaw = cell(raw, 'dob');
    const dob = dobRaw ? parseFlexibleDate(dobRaw) : null;
    if (dobRaw && !dob) errors.push(`Date of Birth "${dobRaw}" is not a valid date (use YYYY-MM-DD or DD-MM-YYYY)`);
    else if (dob && dob > todayStr) errors.push('Date of Birth cannot be in the future');
    const emergencyRaw = cell(raw, 'emergencyContactPhone');
    if (emergencyRaw && !/^\+?\d[\d\s-]{6,14}$/.test(emergencyRaw)) {
      errors.push(`Emergency Contact Number "${emergencyRaw}" is not a valid phone number`);
    }
    const studentCode = cell(raw, 'studentCode') || null;
    if (studentCode && studentCode.length > 30) errors.push('Student ID is too long (max 30 characters)');

    // Match against existing students
    let matched = mobile ? byMobile.get(mobile) ?? null : null;
    if (studentCode) {
      const codeOwner = byCode.get(studentCode.toLowerCase());
      if (codeOwner && matched && codeOwner.id !== matched.id) {
        errors.push(`Student ID "${studentCode}" belongs to a different student than mobile ${mobile}`);
      } else if (codeOwner && !matched) {
        if (mobile && codeOwner.mobile !== mobile) {
          errors.push(`Student ID "${studentCode}" already exists with a different mobile number`);
        } else matched = codeOwner;
      } else if (!codeOwner && matched && matched.studentCode && matched.studentCode.toLowerCase() !== studentCode.toLowerCase()) {
        warnings.push(`Existing student has Student ID ${matched.studentCode}; the ID in the file is ignored`);
      }
      const earlier = seenCodes.get(studentCode.toLowerCase());
      if (mobile && earlier && earlier !== mobile) errors.push(`Student ID "${studentCode}" is used for two different mobiles in this file`);
    }
    if (matched && fullName && matched.fullName.trim().toLowerCase() !== fullName.toLowerCase()) {
      warnings.push(`Mobile already belongs to "${matched.fullName}"; the existing name is kept`);
    }
    if (emailRaw && !matched) {
      const emailOwner = byEmail.get(emailRaw);
      if (emailOwner) warnings.push(`Email is already used by ${emailOwner.fullName} (${emailOwner.mobile}) — check this is a different person`);
    }
    if (mobile) {
      const first = seenStudents.get(mobile);
      if (first && fullName && first.name !== fullName.toLowerCase()) {
        errors.push(`Mobile ${mobile} is used for a different name in row ${first.rowNumber}`);
      }
    }

    // Enrolment fields (all-or-nothing group)
    let enrollment: RowEnrollment | null = null;
    const hasEnrollment = ENROLLMENT_KEYS.some((k) => cell(raw, k) !== '');
    if (hasEnrollment) {
      const courseRaw = cell(raw, 'course');
      const course = courseRaw
        ? courses.find((c) => c.code?.toLowerCase() === courseRaw.toLowerCase()) ??
          courses.find((c) => c.name.trim().toLowerCase() === courseRaw.toLowerCase())
        : undefined;
      if (!courseRaw) errors.push('Course Name or Code is required when enrolment details are given');
      else if (!course) errors.push(`Course "${courseRaw}" does not match any course in the catalogue`);

      const startRaw = cell(raw, 'joiningDate');
      const startISO = startRaw ? parseFlexibleDate(startRaw) : null;
      if (!startRaw) errors.push('Joining Date is required when enrolment details are given');
      else if (!startISO) errors.push(`Joining Date "${startRaw}" is not a valid date (use YYYY-MM-DD or DD-MM-YYYY)`);

      const planRaw = cell(raw, 'plan');
      let plan: CourseWithPlans['plans'][number] | null = null;
      if (!planRaw) errors.push('Plan / Duration is required when enrolment details are given');
      else if (course) {
        plan = matchPlan(course, planRaw);
        if (!plan) {
          errors.push(
            course.plans.length
              ? `Plan "${planRaw}" not found for ${course.name}. Available: ${course.plans.map((p) => p.title).join(', ')}`
              : `${course.name} has no plans configured yet — add a plan under Courses before importing`,
          );
        }
      }

      const endRaw = cell(raw, 'expiryDate');
      let endISO = endRaw ? parseFlexibleDate(endRaw) : null;
      if (endRaw && !endISO) errors.push(`Expiry Date "${endRaw}" is not a valid date (use YYYY-MM-DD or DD-MM-YYYY)`);
      if (!endRaw && startISO && plan) endISO = periodEnd(startISO, plan);
      if (startISO && endISO && endISO < startISO) errors.push('Expiry Date cannot be earlier than Joining Date');

      const money = (key: ColumnKey, label: string): bigint | null => {
        const v = cell(raw, key);
        if (!v) return null;
        const parsed = parseMoney(v);
        if (parsed == null) errors.push(`${label} "${v}" is not a valid non-negative amount`);
        return parsed;
      };
      const feeGiven = money('fee', 'Fee');
      const paidGiven = money('amountPaid', 'Amount Paid');
      const balanceGiven = money('balance', 'Balance');
      const feePaise = feeGiven ?? plan?.pricePaise ?? null;
      const paidPaise = paidGiven ?? 0n;
      if (feePaise != null) {
        if (paidPaise > feePaise) errors.push('Amount Paid is more than the Fee');
        else if (balanceGiven != null && balanceGiven !== feePaise - paidPaise) {
          errors.push(`Balance does not reconcile: Fee minus Amount Paid = ${Number(feePaise - paidPaise) / 100}, file says ${Number(balanceGiven) / 100}`);
        }
        if (feeGiven != null && plan && feeGiven !== plan.pricePaise) {
          warnings.push(`Fee differs from the current plan price (${Number(plan.pricePaise) / 100}); the file value is used`);
        }
      }
      const paymentStatus = feePaise != null ? statusFor(feePaise, paidPaise) : 'UNPAID';
      const payStatusRaw = cell(raw, 'paymentStatus');
      if (payStatusRaw) {
        const given = payStatusRaw.toUpperCase().replace(/[^A-Z]/g, '');
        if (!['PAID', 'PARTIAL', 'UNPAID'].includes(given)) errors.push(`Payment Status "${payStatusRaw}" must be Paid, Partial or Unpaid`);
        else if (feePaise != null && given !== paymentStatus) {
          errors.push(`Payment Status "${payStatusRaw}" does not agree with Fee and Amount Paid (calculated: ${paymentStatus})`);
        }
      }
      const modeRaw = cell(raw, 'paymentMode').toUpperCase().replace(/[\s-]+/g, '_');
      const modes = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'OTHER'];
      if (modeRaw && !modes.includes(modeRaw)) errors.push(`Payment Mode "${cell(raw, 'paymentMode')}" must be one of ${modes.join(', ')}`);

      if (course && plan && startISO && endISO && feePaise != null && !errors.length) {
        const computed = computeEnrollmentStatus(
          { status: 'ACTIVE', startDate: startISO, endDate: endISO, paymentStatus },
          todayStr,
          rules,
        );
        enrollment = {
          courseId: course.id,
          courseName: course.name,
          planId: plan.id,
          planTitle: plan.title,
          startISO,
          endISO,
          feePaise,
          paidPaise,
          paymentStatus,
          paymentMode: (modeRaw || 'OTHER') as PaymentModeInput,
          computedStatus: computed.status,
        };
        const statusRaw = cell(raw, 'status');
        if (statusRaw) {
          const allowed = STATUS_ALIASES[normHeader(statusRaw)];
          if (!allowed) errors.push(`Status "${statusRaw}" is not recognised (use Active, Upcoming, Renewal Due or Expired)`);
          else if (!allowed.includes(computed.status)) {
            warnings.push(`Status "${statusRaw}" in the file differs from the calculated status ${computed.status}; the calculated status is used`);
          }
        }
        if (matched?.status === 'INACTIVE') errors.push('Existing student is deactivated — reactivate before adding an enrolment');
      }
    } else if (cell(raw, 'status')) {
      warnings.push('Status is ignored for a row without enrolment details (status is calculated from enrolments)');
    }

    // Classify
    const student: RowStudent | null =
      mobile && fullName.length >= 2
        ? {
            studentCode,
            fullName,
            mobile,
            email: emailRaw || null,
            dob,
            gender: cell(raw, 'gender') || null,
            address: cell(raw, 'address') || null,
            emergencyContactName: cell(raw, 'emergencyContactName') || null,
            emergencyContactPhone: emergencyRaw || null,
          }
        : null;

    if (errors.length || !student) {
      return { rowNumber, status: 'INVALID', errors, warnings, action: 'Not imported — fix the errors', willImport: false, student, matchedStudentId: matched?.id ?? null, enrollment: null };
    }

    const earlierInFile = seenStudents.get(student.mobile);
    const isExisting = !!matched || !!earlierInFile;
    let status: ImportRowStatus = isExisting ? 'EXISTING_STUDENT' : 'NEW_STUDENT';
    let action: string;
    let willImport = true;

    if (enrollment) {
      const e = enrollment;
      const dbClash = matched?.enrollments.find(
        (x) => x.coursePlan.courseId === e.courseId && toISODate(x.startDate) <= e.endISO && toISODate(x.endDate) >= e.startISO,
      );
      const fileClash = seenEnrollments.find(
        (x) => x.mobile === student.mobile && x.courseId === e.courseId && x.startISO <= e.endISO && x.endISO >= e.startISO,
      );
      if (dbClash) {
        status = 'DUPLICATE';
        action = `Skipped — already enrolled in ${e.courseName} ${toISODate(dbClash.startDate)} to ${toISODate(dbClash.endDate)}`;
        willImport = false;
      } else if (fileClash) {
        status = 'DUPLICATE';
        action = `Skipped — duplicates row ${fileClash.rowNumber} (same student, course and overlapping period)`;
        willImport = false;
      } else {
        seenEnrollments.push({ mobile: student.mobile, courseId: e.courseId, startISO: e.startISO, endISO: e.endISO, rowNumber });
        action = `${isExisting ? 'Add enrolment to existing student' : 'Create student + enrolment'}: ${e.courseName} — ${e.planTitle}, ${e.startISO} to ${e.endISO} (${e.computedStatus}, ${e.paymentStatus})`;
      }
    } else if (earlierInFile) {
      status = 'DUPLICATE';
      action = `Skipped — same student as row ${earlierInFile.rowNumber}`;
      willImport = false;
    } else if (matched) {
      action = 'Existing student — no enrolment in this row (details updated only if "fill blank fields" is chosen)';
    } else {
      action = 'Create student (no enrolment in this row)';
    }

    if (!earlierInFile) seenStudents.set(student.mobile, { rowNumber, name: student.fullName.toLowerCase() });
    if (student.studentCode) seenCodes.set(student.studentCode.toLowerCase(), student.mobile);

    return { rowNumber, status, errors, warnings, action, willImport, student, matchedStudentId: matched?.id ?? null, enrollment };
  });

  const count = (s: ImportRowStatus) => rows.filter((r) => r.status === s).length;
  return {
    fileErrors: [],
    rows,
    summary: {
      totalRows: rows.length,
      importableRows: rows.filter((r) => r.willImport).length,
      newStudents: count('NEW_STUDENT'),
      existingStudents: count('EXISTING_STUDENT'),
      enrollmentsToCreate: rows.filter((r) => r.willImport && r.enrollment).length,
      duplicateRows: count('DUPLICATE'),
      invalidRows: count('INVALID'),
    },
  };
}

// ───────────── Commit ─────────────

/** skip = never touch an existing student's details; fill_blanks = only fill fields that are empty. */
export type UpdatePolicy = 'skip' | 'fill_blanks';

export interface CommitRowResult {
  rowNumber: number;
  result: 'IMPORTED' | 'SKIPPED' | 'FAILED';
  message: string;
  studentId?: string;
}

class SkipRow extends Error {}

export async function commitImport(fileText: string, policy: UpdatePolicy, userId: string, fileName: string) {
  const analysis = await analyzeImport(fileText);
  if (analysis.fileErrors.length) return { analysis, results: [] as CommitRowResult[], summary: null };

  const results: CommitRowResult[] = [];
  let studentsCreated = 0;
  let studentsUpdated = 0;
  let enrollmentsCreated = 0;
  let paymentsCreated = 0;

  for (const row of analysis.rows) {
    if (row.status === 'INVALID') {
      results.push({ rowNumber: row.rowNumber, result: 'FAILED', message: row.errors.join('; ') });
      continue;
    }
    if (!row.willImport || !row.student) {
      results.push({ rowNumber: row.rowNumber, result: 'SKIPPED', message: row.action });
      continue;
    }
    const s = row.student;
    try {
      // One transaction per row: a row is either fully imported or not at all.
      const outcome = await prisma.$transaction(async (tx) => {
        let created = false;
        let updated = false;
        let student = await tx.student.findUnique({ where: { mobile: s.mobile } });
        if (!student) {
          let studentCode = s.studentCode;
          if (studentCode && (await tx.student.findUnique({ where: { studentCode } }))) studentCode = null;
          student = await tx.student.create({
            data: {
              studentCode: studentCode ?? (await nextStudentCode(tx)),
              fullName: s.fullName,
              mobile: s.mobile,
              email: s.email,
              dob: s.dob ? dateOnly(s.dob) : null,
              gender: s.gender,
              address: s.address,
              emergencyContactName: s.emergencyContactName,
              emergencyContactPhone: s.emergencyContactPhone,
              createdById: userId,
            },
          });
          created = true;
        } else if (policy === 'fill_blanks') {
          // Explicit policy: fill only empty fields — an existing value is never overwritten.
          const patch: Record<string, unknown> = {};
          if (!student.email && s.email) patch.email = s.email;
          if (!student.dob && s.dob) patch.dob = dateOnly(s.dob);
          if (!student.gender && s.gender) patch.gender = s.gender;
          if (!student.address && s.address) patch.address = s.address;
          if (!student.emergencyContactName && s.emergencyContactName) patch.emergencyContactName = s.emergencyContactName;
          if (!student.emergencyContactPhone && s.emergencyContactPhone) patch.emergencyContactPhone = s.emergencyContactPhone;
          if (Object.keys(patch).length) {
            student = await tx.student.update({ where: { id: student.id }, data: patch });
            updated = true;
          }
        }

        let enrolled = false;
        let paid = false;
        if (row.enrollment) {
          const e = row.enrollment;
          await lockStudent(tx, student.id);
          const clash = await findOverlappingEnrollment(tx, { studentId: student.id, courseId: e.courseId, startISO: e.startISO, endISO: e.endISO });
          if (clash) throw new SkipRow(`Skipped — already enrolled in ${e.courseName} for an overlapping period`);
          const enrollment = await tx.enrollment.create({
            data: {
              studentId: student.id,
              coursePlanId: e.planId,
              startDate: dateOnly(e.startISO),
              endDate: dateOnly(e.endISO),
              pricePaise: e.feePaise,
              discountPaise: 0n,
              status: e.endISO < addDaysISO(today(), -HISTORICAL_AFTER_DAYS) ? 'EXPIRED' : 'ACTIVE',
              notes: `Legacy import (${fileName}, row ${row.rowNumber})`,
              createdById: userId,
            },
          });
          const invoice = await createInvoiceForEnrollment(tx, enrollment.id, 'ENROLLMENT', userId, 'Imported legacy record');
          enrolled = true;
          if (e.paidPaise > 0n) {
            await recordPaymentTx(tx, {
              invoiceId: invoice.id,
              amountRupees: Number(e.paidPaise) / 100,
              mode: e.paymentMode,
              referenceNo: 'LEGACY-IMPORT',
              paidOn: e.startISO > today() ? today() : e.startISO,
              receivedById: userId,
              notes: `Legacy import (${fileName}, row ${row.rowNumber})`,
              skipReceipt: true,
            });
            paid = true;
          }
        } else if (!created && !updated) {
          throw new SkipRow('Existing student — nothing to add');
        }
        return { studentId: student.id, created, updated, enrolled, paid };
      });
      if (outcome.created) studentsCreated++;
      if (outcome.updated) studentsUpdated++;
      if (outcome.enrolled) enrollmentsCreated++;
      if (outcome.paid) paymentsCreated++;
      results.push({
        rowNumber: row.rowNumber,
        result: 'IMPORTED',
        studentId: outcome.studentId,
        message: [
          outcome.created ? 'student created' : outcome.updated ? 'blank student fields filled' : 'existing student',
          outcome.enrolled ? 'enrolment + invoice created' : null,
          outcome.paid ? 'payment recorded' : null,
        ]
          .filter(Boolean)
          .join(', '),
      });
    } catch (err) {
      if (err instanceof SkipRow) results.push({ rowNumber: row.rowNumber, result: 'SKIPPED', message: err.message });
      else {
        console.error(`[import] row ${row.rowNumber} failed`, err);
        results.push({ rowNumber: row.rowNumber, result: 'FAILED', message: (err as Error).message.split('\n').pop() ?? 'Import failed' });
      }
    }
  }

  const summary = {
    totalRows: analysis.rows.length,
    importedRows: results.filter((r) => r.result === 'IMPORTED').length,
    skippedRows: results.filter((r) => r.result === 'SKIPPED').length,
    failedRows: results.filter((r) => r.result === 'FAILED').length,
    studentsCreated,
    studentsUpdated,
    enrollmentsCreated,
    paymentsCreated,
    updatePolicy: policy,
  };
  await audit(prisma, { userId, action: 'STUDENT_IMPORT', entity: 'student', meta: { fileName, ...summary } });
  return { analysis, results, summary };
}
