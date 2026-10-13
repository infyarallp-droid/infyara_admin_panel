// Shared display helpers for dates, money and computed statuses.

export const inr = (paise: number | string | null | undefined, decimals = false) =>
  `₹${(Number(paise ?? 0) / 100).toLocaleString('en-IN', decimals ? { minimumFractionDigits: 2 } : undefined)}`;

/** YYYY-MM-DD from an API date value. */
export const isoDate = (value?: string | null) => (value ? value.slice(0, 10) : '');

/** 2026-10-09 → 09 Oct 2026 (dates are calendar dates, so no timezone conversion). */
export function fmtDate(value?: string | null): string {
  const iso = isoDate(value);
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d).padStart(2, '0')} ${months[m - 1]} ${y}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

type Tone = 'slate' | 'green' | 'amber' | 'red';

export const ENROLLMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  ACTIVE: { label: 'Active', tone: 'green' },
  UPCOMING: { label: 'Upcoming', tone: 'slate' },
  RENEWAL_DUE: { label: 'Renewal due', tone: 'amber' },
  PENDING_PAYMENT: { label: 'Pending payment', tone: 'amber' },
  EXPIRED: { label: 'Expired', tone: 'red' },
  RENEWED: { label: 'Renewed', tone: 'slate' },
  CANCELLED: { label: 'Cancelled', tone: 'slate' },
};

export const STUDENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  ACTIVE: { label: 'Active', tone: 'green' },
  UPCOMING: { label: 'Upcoming', tone: 'slate' },
  INACTIVE: { label: 'Inactive', tone: 'red' },
  NO_ENROLMENT: { label: 'No enrolment', tone: 'slate' },
};

export const PAYMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  PAID: { label: 'Paid', tone: 'green' },
  PARTIAL: { label: 'Partly paid', tone: 'amber' },
  UNPAID: { label: 'Unpaid', tone: 'red' },
  NONE: { label: 'No invoice', tone: 'slate' },
};

export const DELIVERY_MODE: Record<string, string> = {
  OFFLINE: 'Offline',
  ONLINE: 'Online',
  HYBRID: 'Offline & Online',
};

export function daysLabel(days: number): string {
  if (days < 0) return `expired ${-days}d ago`;
  if (days === 0) return 'ends today';
  return `${days}d left`;
}
