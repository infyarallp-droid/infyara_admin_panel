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

/** A timestamp in the studio's timezone, e.g. 17 Oct 2026, 6:45 pm. */
export function fmtDateTime(value?: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "3 min ago", "2 days ago". */
export function timeAgo(value?: string | null): string {
  if (!value) return 'never';
  const s = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d} day${d === 1 ? '' : 's'} ago` : fmtDateTime(value).split(',')[0];
}

/** A short device description from a user-agent string. */
export function deviceLabel(ua?: string | null): string {
  if (!ua) return 'Unknown device';
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone/iPad' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'Other';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${browser} on ${os}`;
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
