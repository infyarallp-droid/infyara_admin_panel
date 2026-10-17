import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const apiDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
config({ path: [resolve(apiDirectory, '.env'), resolve(apiDirectory, '../../.env')] });

/** Treat an empty env value ("") as not set. */
const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));
const flag = z
  .string()
  .default('false')
  .transform((v) => ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase()));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  API_PUBLIC_URL: z.string().default('http://localhost:4000'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_SECRET: z.string().min(1),
  JWT_REFRESH_SECRET: z.string().min(1),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  // 32-byte hex key for AES-256-GCM PII encryption
  ENCRYPTION_KEY: z.string().length(64),

  STORAGE_PROVIDER: z.enum(['supabase', 'r2', 'local']).default('local'),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_KEY: z.string().optional(),
  SUPABASE_BUCKET: z.string().default('moksha-uploads'),

  // ── Business rules (each is a decision the business owner can change without code) ──
  // One timezone for every expiry / status / reminder calculation.
  BUSINESS_TIMEZONE: z.string().default('Asia/Kolkata'),
  // Does payment gate the Active status? none = as the app has always behaved.
  ACTIVE_REQUIRES_PAYMENT: z.enum(['none', 'partial', 'full']).default('none'),
  // Default pre-filled in the renewal dialog (the admin can always pick another date).
  RENEWAL_START_DEFAULT: z.enum(['TODAY', 'DAY_AFTER_EXPIRY']).default('TODAY'),
  // Allow SUPER_ADMIN/ADMIN to override the duplicate-enrolment block (with a reason).
  DUPLICATE_ENROLLMENT_OVERRIDE: flag,

  // Billing: configurable tax % (0 = no GST for now). Change here or in Settings later.
  TAX_PERCENT: z.coerce.number().min(0).max(100).default(0),

  WHATSAPP_VERIFY_TOKEN: z.string().default('moksha-verify-token'),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_RENEWAL_TEMPLATE: z.string().default('renewal_reminder'),
  // Optional approved templates. Unset = that notification is not sent.
  WHATSAPP_PAYMENT_TEMPLATE: optional,
  WHATSAPP_ADMISSION_TEMPLATE: optional,
  WHATSAPP_TEMPLATE_LANG: z.string().default('en'),
  WHATSAPP_DEFAULT_COUNTRY_CODE: z.string().regex(/^[0-9]{1,3}$/).default('91'),
  WHATSAPP_API_BASE_URL: z.string().default('https://graph.facebook.com/v20.0'),
  WHATSAPP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  // Days-before-expiry to send renewal reminders (comma-separated).
  RENEWAL_REMINDER_DAYS: z.string().default('7,3,1'),

  PUBLIC_LEADS_API_KEY: z.string().default('change-me-public-api-key'),
  GOOGLE_FORM_SHARED_SECRET: z.string().default('change-me-google-secret'),

  // ── Website ↔ API ──
  // Shared secret the website's server sends on every account/auth call (never reaches a browser).
  WEBSITE_SERVICE_KEY: z.string().default('change-me-website-service-key'),
  // Public website address (on-demand revalidation after content is published, payment redirects).
  WEBSITE_URL: optional,
  WEBSITE_REVALIDATE_SECRET: optional,
  CUSTOMER_SESSION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  // Google sign-in: the OAuth client id (the website holds the client secret).
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_JWKS_URL: z.string().default('https://www.googleapis.com/oauth2/v3/certs'),

  // ── Media for the public website (public bucket) ──
  SUPABASE_PUBLIC_BUCKET: z.string().default('moksha-public'),
  MEDIA_MAX_IMAGE_MB: z.coerce.number().min(1).max(20).default(8),
  MEDIA_MAX_VIDEO_MB: z.coerce.number().min(1).max(200).default(50),

  // ── WhatsApp extras ──
  // Business-initiated messages need recorded opt-in. "false" only for local testing.
  WHATSAPP_REQUIRE_CONSENT: z
    .string()
    .default('true')
    .transform((v) => !['0', 'false', 'no', 'off'].includes(v.trim().toLowerCase())),
  // WhatsApp Business Account id — needed only for "Sync templates from Meta".
  WHATSAPP_BUSINESS_ACCOUNT_ID: optional,

  // ── Razorpay ──
  RAZORPAY_KEY_ID: optional,
  RAZORPAY_KEY_SECRET: optional,
  RAZORPAY_WEBHOOK_SECRET: optional,
  RAZORPAY_API_BASE_URL: z.string().default('https://api.razorpay.com/v1'),

  // ── Scheduled jobs ──
  // Secret for POST /internal/jobs/tick (called by Render Cron / an external scheduler).
  CRON_SECRET: optional,
  // Also run the tick inside the API process every N seconds (only on an always-on instance).
  INTERNAL_SCHEDULER_SECONDS: z.coerce.number().int().min(0).max(3600).default(0),
});

const parsed = schema.parse(process.env);

// Refuse to start in production with sample/default secrets or fail-open settings.
if (parsed.NODE_ENV === 'production') {
  const problems: string[] = [];
  const weak = (name: keyof typeof parsed, value: string | undefined, sample: string[]) => {
    if (!value || sample.includes(value) || value.length < 24) problems.push(`${String(name)} must be set to a long random value`);
  };
  weak('JWT_SECRET', parsed.JWT_SECRET, ['change-me-access-secret']);
  weak('JWT_REFRESH_SECRET', parsed.JWT_REFRESH_SECRET, ['change-me-refresh-secret']);
  weak('PUBLIC_LEADS_API_KEY', parsed.PUBLIC_LEADS_API_KEY, ['change-me-public-api-key']);
  weak('GOOGLE_FORM_SHARED_SECRET', parsed.GOOGLE_FORM_SHARED_SECRET, ['change-me-google-secret']);
  weak('WEBSITE_SERVICE_KEY', parsed.WEBSITE_SERVICE_KEY, ['change-me-website-service-key']);
  if (/^0+$/.test(parsed.ENCRYPTION_KEY)) problems.push('ENCRYPTION_KEY must not be the sample all-zero key');
  if (parsed.STORAGE_PROVIDER === 'local') problems.push('STORAGE_PROVIDER=local loses files on every deploy — use supabase');
  if (parsed.WHATSAPP_ACCESS_TOKEN && !parsed.WHATSAPP_APP_SECRET) {
    problems.push('WHATSAPP_APP_SECRET is required when WhatsApp is configured (webhook signature check)');
  }
  if (parsed.WHATSAPP_ACCESS_TOKEN && parsed.WHATSAPP_VERIFY_TOKEN === 'moksha-verify-token') {
    problems.push('WHATSAPP_VERIFY_TOKEN must not be the sample value');
  }
  if (parsed.RAZORPAY_KEY_ID && !parsed.RAZORPAY_WEBHOOK_SECRET) {
    problems.push('RAZORPAY_WEBHOOK_SECRET is required when Razorpay is configured');
  }
  if (problems.length) {
    throw new Error(`Unsafe production configuration:\n - ${problems.join('\n - ')}`);
  }
}

export const env = parsed;
export type Env = z.infer<typeof schema>;

/** Allowed browser origins for CORS (WEB_ORIGIN may list several, comma-separated). */
export const webOrigins = env.WEB_ORIGIN.split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);
