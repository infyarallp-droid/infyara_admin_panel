import { z } from 'zod';

// Shared enums (kept in sync with prisma/schema.prisma)
export const UserRole = z.enum([
  'SUPER_ADMIN',
  'ADMIN',
  'MANAGER',
  'FRONT_DESK',
  'ACCOUNTANT',
  'TRAINER',
]);
export type UserRole = z.infer<typeof UserRole>;

export const LeadSource = z.enum([
  'WHATSAPP',
  'WEBSITE',
  'GOOGLE_FORM',
  'LINKEDIN',
  'WALK_IN',
  'REFERRAL',
  'OTHER',
]);
export type LeadSource = z.infer<typeof LeadSource>;

// ── Auth ──
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});
export type LoginInput = z.infer<typeof loginSchema>;

// ── Student ──
/** Reduce a typed/pasted Indian mobile (+91, 0 prefix, spaces, dashes) to its 10 digits; null if it is not one. */
export function normalizeMobile(raw: string): string | null {
  let digits = raw.replace(/[\s\-().+]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^\d{10}$/.test(digits) ? digits : null;
}

const PHONE_LOOSE = /^\+?\d[\d\s-]{6,14}$/;

export const studentSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name is required'),
  mobile: z.string().trim().regex(/^\d{10}$/, 'Enter a 10-digit mobile'),
  email: z.string().trim().email('Enter a valid email').optional().or(z.literal('')),
  dob: z.string().optional(),
  gender: z.string().optional(),
  address: z.string().optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z
    .string()
    .trim()
    .regex(PHONE_LOOSE, 'Enter a valid emergency phone number')
    .optional()
    .or(z.literal('')),
  emergencyContactRelation: z.string().optional(),
  isMinor: z.boolean().default(false),
});
export type StudentInput = z.infer<typeof studentSchema>;

// ── Public lead intake (used by website/Google Form/Zapier) ──
export const publicLeadSchema = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  message: z.string().optional(),
  source: LeadSource.default('WEBSITE'),
  sourceDetail: z.record(z.unknown()).optional(),
});
export type PublicLeadInput = z.infer<typeof publicLeadSchema>;

// ───────────────────────── Calendar dates ─────────────────────────
// Calendar-date helpers. Enrolment dates are stored as DATE columns, so all
// status/expiry maths works on YYYY-MM-DD strings in one business timezone —
// never on the server's or the browser's local clock.

export const DEFAULT_BUSINESS_TZ = 'Asia/Kolkata';
const DAY_MS = 86_400_000;

/** Today's calendar date (YYYY-MM-DD) in the business timezone. */
export function todayISO(timeZone: string = DEFAULT_BUSINESS_TZ, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Strictly parse YYYY-MM-DD into a UTC-midnight Date; null when not a real calendar date. */
export function parseISODate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date;
}

/** YYYY-MM-DD for a DATE value (a UTC-midnight Date or an ISO string). */
export function toISODate(value: Date | string): string {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

export function addDaysISO(iso: string, days: number): string {
  const d = parseISODate(iso);
  if (!d) throw new Error(`Invalid date: ${iso}`);
  return new Date(d.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function diffDaysISO(to: string, from: string): number {
  const a = parseISODate(to);
  const b = parseISODate(from);
  if (!a || !b) throw new Error(`Invalid date: ${to} / ${from}`);
  return Math.round((a.getTime() - b.getTime()) / DAY_MS);
}

/**
 * Parse the date formats a legacy spreadsheet is likely to contain:
 * YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY (day first, as used in India).
 * Returns YYYY-MM-DD, or null when the value is ambiguous or not a real date.
 */
export function parseFlexibleDate(value: string): string | null {
  const v = value.trim();
  if (parseISODate(v)) return v;
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(v);
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return parseISODate(iso) ? iso : null;
}

// ───────────────────────── Status rules ─────────────────────────

// Status is always derived from saved dates + lifecycle flags, never from a
// manually typed label. Enrolment status and student status are separate: one
// expired enrolment never deactivates a student who has another valid one.

export type EnrollmentDisplayStatus =
  | 'UPCOMING'
  | 'ACTIVE'
  | 'RENEWAL_DUE'
  | 'PENDING_PAYMENT'
  | 'EXPIRED'
  | 'RENEWED'
  | 'CANCELLED';

export type PaymentSummaryStatus = 'NONE' | 'UNPAID' | 'PARTIAL' | 'PAID';

/** Whether payment gates the Active status. 'none' is the behaviour the app has always had. */
export type ActivePaymentRule = 'none' | 'partial' | 'full';

export interface StatusRules {
  renewalWindowDays: number;
  activeRequiresPayment: ActivePaymentRule;
}

export const DEFAULT_STATUS_RULES: StatusRules = { renewalWindowDays: 7, activeRequiresPayment: 'none' };

export interface EnrollmentStatusInput {
  /** Stored lifecycle flag: ACTIVE | COMPLETED (superseded by a renewal) | CANCELLED | EXPIRED */
  status: string;
  startDate: Date | string;
  endDate: Date | string;
  paymentStatus?: PaymentSummaryStatus | null;
  /** Start date of the renewal that continues this period, if it has been renewed. */
  renewalStartDate?: Date | string | null;
}

export interface EnrollmentStatusResult {
  status: EnrollmentDisplayStatus;
  reason: string;
  /** Days until the end date (negative once expired). */
  daysRemaining: number;
}

function paymentSatisfied(rule: ActivePaymentRule, payment: PaymentSummaryStatus | null | undefined): boolean {
  // No linked invoice (NONE / unknown) cannot be judged, so it never blocks.
  if (rule === 'none' || !payment || payment === 'NONE') return true;
  if (rule === 'full') return payment === 'PAID';
  return payment === 'PAID' || payment === 'PARTIAL';
}

export function computeEnrollmentStatus(
  e: EnrollmentStatusInput,
  today: string,
  rules: StatusRules = DEFAULT_STATUS_RULES,
): EnrollmentStatusResult {
  const start = toISODate(e.startDate);
  const end = toISODate(e.endDate);
  const daysRemaining = diffDaysISO(end, today);

  if (e.status === 'CANCELLED') return { status: 'CANCELLED', reason: 'Enrolment was cancelled', daysRemaining };
  if (e.status === 'COMPLETED') {
    // Renewed ahead of time: this period is still the one in use until the renewal begins.
    const renewalStart = e.renewalStartDate ? toISODate(e.renewalStartDate) : null;
    if (renewalStart && today >= start && today <= end && today < renewalStart) {
      return { status: 'ACTIVE', reason: `Valid to ${end} — renewed, next period starts ${renewalStart}`, daysRemaining };
    }
    return { status: 'RENEWED', reason: 'Period closed — continued by a renewal', daysRemaining };
  }
  if (today < start) return { status: 'UPCOMING', reason: `Starts on ${start}`, daysRemaining };
  if (today > end || e.status === 'EXPIRED') {
    return { status: 'EXPIRED', reason: `Ended on ${end} with no renewal`, daysRemaining };
  }
  if (!paymentSatisfied(rules.activeRequiresPayment, e.paymentStatus)) {
    return {
      status: 'PENDING_PAYMENT',
      reason:
        rules.activeRequiresPayment === 'full'
          ? 'Within dates, but full payment is required before activation'
          : 'Within dates, but a payment is required before activation',
      daysRemaining,
    };
  }
  if (daysRemaining <= rules.renewalWindowDays) {
    return {
      status: 'RENEWAL_DUE',
      reason: daysRemaining === 0 ? 'Ends today' : `Ends on ${end} (${daysRemaining} day${daysRemaining === 1 ? '' : 's'} left)`,
      daysRemaining,
    };
  }
  return { status: 'ACTIVE', reason: `Valid ${start} to ${end}`, daysRemaining };
}

export type StudentDisplayStatus = 'ACTIVE' | 'UPCOMING' | 'INACTIVE' | 'NO_ENROLMENT';

export interface StudentStatusResult {
  status: StudentDisplayStatus;
  reason: string;
  /** True only when an administrator deactivated the student by hand. */
  manual: boolean;
  effectiveDate: string | null;
}

export function computeStudentStatus(
  student: {
    /** Stored manual flag: ACTIVE | INACTIVE */
    status: string;
    deactivationReason?: string | null;
    deactivationEffectiveDate?: Date | string | null;
  },
  enrollments: { status: EnrollmentDisplayStatus; endDate: Date | string }[],
): StudentStatusResult {
  if (student.status === 'INACTIVE') {
    const effective = student.deactivationEffectiveDate ? toISODate(student.deactivationEffectiveDate) : null;
    return {
      status: 'INACTIVE',
      reason: `Deactivated by admin${student.deactivationReason ? `: ${student.deactivationReason}` : ''}`,
      manual: true,
      effectiveDate: effective,
    };
  }
  const live = enrollments.filter((e) => ['ACTIVE', 'RENEWAL_DUE', 'PENDING_PAYMENT'].includes(e.status));
  if (live.length) {
    return {
      status: 'ACTIVE',
      reason: `${live.length} current enrolment${live.length === 1 ? '' : 's'}`,
      manual: false,
      effectiveDate: null,
    };
  }
  if (enrollments.some((e) => e.status === 'UPCOMING')) {
    return { status: 'UPCOMING', reason: 'Enrolment starts in the future', manual: false, effectiveDate: null };
  }
  if (!enrollments.length) {
    return { status: 'NO_ENROLMENT', reason: 'No enrolment recorded yet', manual: false, effectiveDate: null };
  }
  const lastEnd = enrollments.map((e) => toISODate(e.endDate)).sort().pop() ?? null;
  return {
    status: 'INACTIVE',
    reason: `No current enrolment — all enrolments expired or cancelled${lastEnd ? ` (last ended ${lastEnd})` : ''}`,
    manual: false,
    effectiveDate: lastEnd,
  };
}
