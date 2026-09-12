import 'dotenv/config';
import { z } from 'zod';

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

  // Billing: configurable tax % (0 = no GST for now). Change here or in Settings later.
  TAX_PERCENT: z.coerce.number().min(0).max(100).default(0),

  WHATSAPP_VERIFY_TOKEN: z.string().default('moksha-verify-token'),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_RENEWAL_TEMPLATE: z.string().default('renewal_reminder'),
  // Days-before-expiry to send renewal reminders (comma-separated).
  RENEWAL_REMINDER_DAYS: z.string().default('7,3,1'),

  PUBLIC_LEADS_API_KEY: z.string().default('change-me-public-api-key'),
  GOOGLE_FORM_SHARED_SECRET: z.string().default('change-me-google-secret'),
});

export const env = schema.parse(process.env);
export type Env = z.infer<typeof schema>;
