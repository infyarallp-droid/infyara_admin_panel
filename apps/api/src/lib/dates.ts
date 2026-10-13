import { addDaysISO, parseISODate, todayISO, toISODate, type StatusRules } from '@moksha/shared';
import { env } from './env.js';
import { HttpError } from './http.js';

/** Today's calendar date (YYYY-MM-DD) in the configured business timezone. */
export const today = (): string => todayISO(env.BUSINESS_TIMEZONE);

/** A DATE-column value (UTC midnight) for a YYYY-MM-DD string. */
export function dateOnly(iso: string): Date {
  const d = parseISODate(iso);
  if (!d) throw new HttpError(400, `Invalid date "${iso}" — use YYYY-MM-DD`);
  return d;
}

/** Validate a request date field and return it as YYYY-MM-DD. */
export function requireISODate(value: string, field: string): string {
  const iso = value.trim().slice(0, 10);
  if (!parseISODate(iso)) throw new HttpError(400, `${field} is not a valid date (use YYYY-MM-DD)`);
  return iso;
}

/** Days-before-expiry at which renewal reminders go out (configured, never hard-coded). */
export function reminderOffsets(): number[] {
  const offsets = env.RENEWAL_REMINDER_DAYS.split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n >= 0);
  return [...new Set(offsets)].sort((a, b) => a - b);
}

/** Rules used wherever an enrolment/student status is computed. */
export function statusRules(): StatusRules {
  const offsets = reminderOffsets();
  return {
    renewalWindowDays: offsets.length ? Math.max(...offsets) : 7,
    activeRequiresPayment: env.ACTIVE_REQUIRES_PAYMENT,
  };
}

export { addDaysISO, toISODate };

/** Calendar date (YYYY-MM-DD) of a timestamp, as seen in the business timezone. */
export const businessDate = (at: Date): string => todayISO(env.BUSINESS_TIMEZONE, at);
