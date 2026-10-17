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

// ───────────────────────── Website accounts ─────────────────────────

/** Indian mobile that WhatsApp/SMS can reach: 10 digits starting 6–9 (after normalisation). */
export function normalizeIndianMobile(raw: string): string | null {
  const local = normalizeMobile(raw);
  return local && /^[6-9]/.test(local) ? local : null;
}

const mobileField = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const m = normalizeIndianMobile(v);
    if (!m) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid 10-digit mobile number' });
    return m ?? '';
  });

/** bcrypt only uses the first 72 bytes, so longer passwords are rejected rather than silently truncated. */
export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(72, 'Use at most 72 characters')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Use at least one letter and one number');

/** Wording shown next to the WhatsApp opt-in checkbox; stored with every consent record. */
export const WHATSAPP_CONSENT_TEXT =
  'I agree to receive class reminders, payment updates and studio announcements from Moksha Wellness on WhatsApp. I can opt out at any time by replying STOP or from my account settings.';

/** Emails are compared and stored lower-case. */
const emailField = z
  .string()
  .trim()
  .max(120)
  .email('Enter a valid email address')
  .transform((v) => v.toLowerCase());

export const customerSignupSchema = z
  .object({
    /** How the person chose to sign up. Either way the mobile number is mandatory. */
    method: z.enum(['MOBILE_PASSWORD', 'EMAIL_PASSWORD']).default('MOBILE_PASSWORD'),
    fullName: z.string().trim().min(2, 'Please enter your full name').max(80),
    mobile: mobileField,
    email: emailField.optional().or(z.literal('').transform(() => undefined)),
    password: passwordSchema,
    whatsappOptIn: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.method === 'EMAIL_PASSWORD' && !v.email) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['email'], message: 'Enter your email address' });
    }
  });
export type CustomerSignupInput = z.infer<typeof customerSignupSchema>;

/** Sign in with a mobile number or an email address, plus the password. */
export const customerLoginSchema = z
  .object({
    identifier: z.string().trim().max(120).optional(),
    /** Older clients send the mobile number in this field. */
    mobile: z.string().trim().max(30).optional(),
    password: z.string().min(1, 'Enter your password').max(200),
  })
  .transform((v, ctx) => {
    const raw = (v.identifier || v.mobile || '').trim();
    if (raw.includes('@')) {
      const email = emailField.safeParse(raw);
      if (email.success) return { kind: 'email' as const, email: email.data, password: v.password };
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['identifier'], message: 'Enter a valid email address' });
      return z.NEVER;
    }
    const mobile = normalizeIndianMobile(raw);
    if (mobile) return { kind: 'mobile' as const, mobile, password: v.password };
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['identifier'], message: 'Enter your 10-digit mobile number or your email address' });
    return z.NEVER;
  });

/** Second step of "Continue with Google": every account must have a mobile number. */
export const googleCompleteSchema = z.object({
  pendingToken: z.string().min(20),
  fullName: z.string().trim().min(2, 'Please enter your full name').max(80),
  mobile: mobileField,
  whatsappOptIn: z.boolean().default(false),
});

export const accountProfileSchema = z.object({
  fullName: z.string().trim().min(2, 'Please enter your full name').max(80),
  email: emailField.optional().or(z.literal('').transform(() => undefined)),
});

// ───────────────────────── Website content (CMS) ─────────────────────────

/** A link target that is safe to render: a site path, https URL, tel: or mailto:. Never javascript:. */
export function isSafeHref(v: string): boolean {
  const s = v.trim();
  if (!s) return true;
  if (s.startsWith('/') && !s.startsWith('//')) return true;
  return /^(https:\/\/|http:\/\/localhost|tel:|mailto:)/i.test(s);
}
export const safeHref = z
  .string()
  .trim()
  .max(500)
  .refine(isSafeHref, 'Use a page path such as /contact, or a full https:// link');

export type ContentFieldType = 'text' | 'textarea' | 'href' | 'image' | 'lines' | 'list';

export interface ContentField {
  name: string;
  label: string;
  type: ContentFieldType;
  help?: string;
  max?: number;
  required?: boolean;
  /** For type "list": the fields of each item. */
  fields?: ContentField[];
  maxItems?: number;
}

export interface ContentBlockDef {
  key: string;
  label: string;
  /** Website page the block appears on (used for the preview link). */
  page: string;
  fields: ContentField[];
}

const t = (name: string, label: string, max = 120, extra: Partial<ContentField> = {}): ContentField => ({ name, label, type: 'text', max, ...extra });
const ta = (name: string, label: string, max = 800, extra: Partial<ContentField> = {}): ContentField => ({ name, label, type: 'textarea', max, ...extra });
const href = (name: string, label: string, extra: Partial<ContentField> = {}): ContentField => ({ name, label, type: 'href', max: 500, ...extra });
const img = (name: string, label: string, help?: string): ContentField => ({ name, label, type: 'image', help });
const titledItems = (name: string, label: string, maxItems: number, withLink = false): ContentField => ({
  name,
  label,
  type: 'list',
  maxItems,
  fields: [
    t('title', 'Title', 80, { required: true }),
    ta('text', 'Text', 400),
    ...(withLink ? [t('ctaLabel', 'Link text', 40), href('ctaHref', 'Link')] : []),
  ],
});

export const CONTENT_BLOCKS: ContentBlockDef[] = [
  {
    key: 'site.settings',
    label: 'Contact details & footer',
    page: '/contact',
    fields: [
      t('tagline', 'Tagline', 60),
      ta('description', 'Short description (footer & search engines)', 300),
      t('phone', 'Phone (display)', 30, { help: 'e.g. +91 98765 43210' }),
      t('whatsapp', 'WhatsApp number', 20, { help: 'International digits only, e.g. 919876543210. Shows the floating WhatsApp button.' }),
      t('email', 'Email', 120),
      { name: 'address', label: 'Address', type: 'lines', max: 120, maxItems: 5, help: 'One line per row' },
      href('mapsUrl', 'Google Maps / listing link'),
      { name: 'hours', label: 'Opening hours', type: 'list', maxItems: 7, fields: [t('days', 'Days', 40, { required: true }), t('time', 'Time', 60, { required: true })] },
      href('instagram', 'Instagram link'),
      href('facebook', 'Facebook link'),
      href('youtube', 'YouTube link'),
      t('footerNote', 'Footer note', 200),
    ],
  },
  {
    key: 'home.hero',
    label: 'Home — hero',
    page: '/',
    fields: [
      t('eyebrow', 'Small heading', 80),
      t('title', 'Headline', 80, { required: true }),
      t('titleEmphasis', 'Headline — highlighted ending', 60),
      ta('body', 'Introduction', 400),
      t('primaryCtaLabel', 'Main button text', 40),
      href('primaryCtaHref', 'Main button link'),
      t('secondaryCtaLabel', 'Second button text', 40),
      href('secondaryCtaHref', 'Second button link'),
      img('imageUrl', 'Hero image (optional)', 'Leave empty to show the lotus illustration. Use a photo at least 1200px wide.'),
    ],
  },
  {
    key: 'home.pillars',
    label: 'Home — ways to practise',
    page: '/',
    fields: [t('eyebrow', 'Small heading', 80), t('title', 'Heading', 120), ta('intro', 'Introduction', 400), titledItems('items', 'Cards', 6, true)],
  },
  {
    key: 'home.sections',
    label: 'Home — section headings',
    page: '/',
    fields: [
      t('classesEyebrow', 'Classes — small heading', 80),
      t('classesTitle', 'Classes — heading', 120),
      t('trainingEyebrow', 'Training — small heading', 80),
      t('trainingTitle', 'Training — heading', 120),
      ta('trainingBody', 'Training — text', 500),
      t('testimonialsEyebrow', 'Student stories — small heading', 80),
      t('testimonialsTitle', 'Student stories — heading', 120),
      t('teamEyebrow', 'Team — small heading', 80),
      t('teamTitle', 'Team — heading', 120),
      t('faqEyebrow', 'FAQ — small heading', 80),
      t('faqTitle', 'FAQ — heading', 120),
    ],
  },
  {
    key: 'home.steps',
    label: 'Home — getting started steps',
    page: '/',
    fields: [t('eyebrow', 'Small heading', 80), t('title', 'Heading', 120), titledItems('items', 'Steps', 5)],
  },
  {
    key: 'home.cta',
    label: 'Home — closing call to action',
    page: '/',
    fields: [t('title', 'Heading', 80, { required: true }), ta('body', 'Text', 300)],
  },
  {
    key: 'about.page',
    label: 'About page',
    page: '/about',
    fields: [
      t('heroEyebrow', 'Small heading', 80),
      t('heroTitle', 'Headline', 120, { required: true }),
      ta('heroBody', 'Introduction', 600),
      img('imageUrl', 'Photo (optional)', 'Leave empty to show the logo.'),
      t('offerEyebrow', 'What we offer — small heading', 80),
      t('offerTitle', 'What we offer — heading', 120),
      { name: 'offerParagraphs', label: 'What we offer — paragraphs', type: 'lines', max: 800, maxItems: 6, help: 'One paragraph per row' },
      t('valuesEyebrow', 'Values — small heading', 80),
      t('valuesTitle', 'Values — heading', 160),
      titledItems('values', 'Values', 8),
      t('ctaTitle', 'Closing heading', 80),
      ta('ctaBody', 'Closing text', 300),
    ],
  },
  {
    key: 'classes.page',
    label: 'Classes page',
    page: '/classes',
    fields: [
      t('heroEyebrow', 'Small heading', 80),
      t('heroTitle', 'Headline', 120, { required: true }),
      ta('heroBody', 'Introduction', 600),
      t('onlineEyebrow', 'Online — small heading', 80),
      t('onlineTitle', 'Online — heading', 120),
      t('studioEyebrow', 'Studio — small heading', 80),
      t('studioTitle', 'Studio — heading', 120),
      t('ctaTitle', 'Closing heading', 80),
      ta('ctaBody', 'Closing text', 300),
    ],
  },
  {
    key: 'training.page',
    label: 'Teacher training page',
    page: '/teacher-training',
    fields: [
      t('heroEyebrow', 'Small heading', 80),
      t('heroTitle', 'Headline', 120, { required: true }),
      ta('heroBody', 'Introduction', 600),
      t('expectEyebrow', 'Expectations — small heading', 80),
      t('expectTitle', 'Expectations — heading', 120),
      titledItems('expectations', 'Expectations', 6),
      t('ctaTitle', 'Closing heading', 80),
      ta('ctaBody', 'Closing text', 300),
    ],
  },
  {
    key: 'contact.page',
    label: 'Contact page',
    page: '/contact',
    fields: [
      t('heroEyebrow', 'Small heading', 80),
      t('heroTitle', 'Headline', 120, { required: true }),
      ta('heroBody', 'Introduction', 600),
      { name: 'nextSteps', label: '"What happens next" steps', type: 'lines', max: 200, maxItems: 5, help: 'One step per row' },
    ],
  },
  {
    key: 'team.page',
    label: 'Team page',
    page: '/team',
    fields: [t('heroEyebrow', 'Small heading', 80), t('heroTitle', 'Headline', 120, { required: true }), ta('heroBody', 'Introduction', 600)],
  },
  {
    key: 'testimonials.page',
    label: 'Student stories page',
    page: '/testimonials',
    fields: [t('heroEyebrow', 'Small heading', 80), t('heroTitle', 'Headline', 120, { required: true }), ta('heroBody', 'Introduction', 600)],
  },
  {
    key: 'gallery.page',
    label: 'Gallery page',
    page: '/gallery',
    fields: [t('heroEyebrow', 'Small heading', 80), t('heroTitle', 'Headline', 120, { required: true }), ta('heroBody', 'Introduction', 600)],
  },
  // Policy pages: shown on the website (and linked in the footer) only once published.
  // Razorpay's website review expects all three.
  ...(
    [
      ['legal.privacy', 'Privacy policy', '/privacy'],
      ['legal.terms', 'Terms & conditions', '/terms'],
      ['legal.refunds', 'Cancellation & refund policy', '/refund-policy'],
    ] as const
  ).map(
    ([key, label, page]): ContentBlockDef => ({
      key,
      label,
      page,
      fields: [
        t('title', 'Page title', 120, { required: true }),
        t('updated', 'Last updated', 40, { help: 'e.g. 17 October 2026' }),
        ta('intro', 'Introduction', 1500),
        {
          name: 'sections',
          label: 'Sections',
          type: 'list',
          maxItems: 25,
          fields: [t('title', 'Heading', 120, { required: true }), ta('text', 'Text', 4000, { help: 'Separate paragraphs with a blank line.' })],
        },
      ],
    }),
  ),
];

/** Policy blocks: never shown from built-in defaults — only after an admin publishes them. */
export const LEGAL_BLOCK_KEYS = ['legal.privacy', 'legal.terms', 'legal.refunds'];

export const CONTENT_BLOCK_KEYS = CONTENT_BLOCKS.map((b) => b.key);

/** Public media URL: https in production; http://localhost allowed for local development. */
export const mediaUrlSchema = z
  .string()
  .trim()
  .max(1000)
  .refine(
    (v) => v === '' || /^https:\/\//.test(v) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(v),
    'Upload a file or use an https:// link',
  );

function fieldSchema(f: ContentField): z.ZodTypeAny {
  switch (f.type) {
    case 'href':
      return safeHref.optional().default('');
    case 'image':
      return mediaUrlSchema.optional().default('');
    case 'lines':
      return z
        .array(z.string().trim().max(f.max ?? 800))
        .max(f.maxItems ?? 20)
        .transform((rows) => rows.filter(Boolean))
        .optional()
        .default([]);
    case 'list': {
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const sub of f.fields ?? []) shape[sub.name] = fieldSchema(sub);
      return z.array(z.object(shape)).max(f.maxItems ?? 20, `${f.label}: at most ${f.maxItems ?? 20} items`).optional().default([]);
    }
    default: {
      const base = z.string().trim().max(f.max ?? 800, `${f.label}: at most ${f.max ?? 800} characters`);
      return f.required ? base.min(1, `${f.label} is required`) : base.optional().default('');
    }
  }
}

/** Zod schema for a block's JSON, built from its field list (unknown keys are dropped). */
export function contentBlockSchema(key: string) {
  const def = CONTENT_BLOCKS.find((b) => b.key === key);
  if (!def) return null;
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of def.fields) shape[f.name] = fieldSchema(f);
  return z.object(shape);
}

// ───────────────────────── WhatsApp reminders ─────────────────────────

export const REMINDER_TRIGGERS = [
  { value: 'ENROLLMENT_EXPIRY', label: 'Renewal reminder: days before an enrolment ends', usesOffset: true },
  { value: 'ENROLLMENT_START', label: 'Class reminder: days before an enrolment starts', usesOffset: true },
  { value: 'INVOICE_DUE', label: 'Payment reminder: days before an unpaid invoice is due (negative = overdue)', usesOffset: true },
  { value: 'ENROLLMENT_CREATED', label: 'Enrolment confirmation: when an enrolment is created', usesOffset: false },
  { value: 'PAYMENT_RECEIVED', label: 'Payment confirmation: when a payment is recorded', usesOffset: false },
] as const;
export type ReminderTrigger = (typeof REMINDER_TRIGGERS)[number]['value'];
export const REMINDER_TRIGGER_VALUES = REMINDER_TRIGGERS.map((r) => r.value) as [ReminderTrigger, ...ReminderTrigger[]];

/** Placeholders an admin can put in a template variable; resolved per recipient. */
export const MESSAGE_PLACEHOLDERS = [
  { token: '{name}', label: 'Student name' },
  { token: '{first_name}', label: 'First name' },
  { token: '{course}', label: 'Course and plan' },
  { token: '{start_date}', label: 'Enrolment start date' },
  { token: '{end_date}', label: 'Enrolment end date' },
  { token: '{invoice_no}', label: 'Invoice number' },
  { token: '{amount}', label: 'Amount (payment or invoice total)' },
  { token: '{balance}', label: 'Outstanding balance' },
  { token: '{due_date}', label: 'Invoice due date' },
] as const;

/** Replace {placeholders} in each template variable with the recipient's values (unknown ones become empty). */
export function fillPlaceholders(params: string[], values: Record<string, string | null | undefined>): string[] {
  return params.map((p) => p.replace(/\{([a-z_]+)\}/g, (_m, key: string) => values[key] ?? '').trim());
}
