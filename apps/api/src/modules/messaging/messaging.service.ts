import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../lib/env.js';
import { isWhatsAppConfigured, sendWhatsAppTemplate, toWhatsAppRecipient } from '../../lib/whatsappSend.js';

export type MessageEvent = 'RENEWAL_REMINDER' | 'PAYMENT_RECEIVED' | 'ADMISSION_CONFIRMATION';

export type MessageOutcome =
  | 'SENT'
  | 'FAILED'
  | 'DUPLICATE' // already sent (or in flight) for this event + window
  | 'NOT_CONFIGURED' // credentials/template missing — logged as pending setup, never as success
  | 'INVALID_RECIPIENT'
  | 'MAX_ATTEMPTS';

export interface SendArgs {
  event: MessageEvent;
  /** Identifies "this event for this window"; the same key is delivered at most once. */
  dedupeKey: string;
  studentId?: string | null;
  enrollmentId?: string | null;
  mobile: string | null | undefined;
  templateName: string;
  params: string[];
  /** CRON, or MANUAL:<userId> */
  triggeredBy: string;
}

export interface SendOutcome {
  outcome: MessageOutcome;
  logId?: string;
  rateLimited?: boolean;
  error?: string;
}

const IN_FLIGHT_MS = 5 * 60_000;
const json = (v: unknown) => (v == null ? Prisma.JsonNull : (v as Prisma.InputJsonValue));

/**
 * Send a WhatsApp template exactly once per dedupeKey and record what happened:
 * trigger, recipient, timestamp, provider response and send status.
 */
export async function sendLoggedTemplate(args: SendArgs): Promise<SendOutcome> {
  const base = {
    event: args.event,
    studentId: args.studentId ?? null,
    enrollmentId: args.enrollmentId ?? null,
    templateName: args.templateName,
    params: args.params,
    triggeredBy: args.triggeredBy,
  };

  const existing = await prisma.messageLog.findUnique({ where: { dedupeKey: args.dedupeKey } });
  if (existing) {
    if (['SENT', 'DELIVERED', 'READ'].includes(existing.status)) return { outcome: 'DUPLICATE', logId: existing.id };
    if (existing.status === 'PENDING' && Date.now() - existing.updatedAt.getTime() < IN_FLIGHT_MS) {
      return { outcome: 'DUPLICATE', logId: existing.id };
    }
    if (existing.status === 'FAILED' && existing.attempts >= env.WHATSAPP_MAX_ATTEMPTS) {
      return { outcome: 'MAX_ATTEMPTS', logId: existing.id, error: existing.error ?? undefined };
    }
  }

  const recipient = toWhatsAppRecipient(args.mobile);
  if (!recipient || !isWhatsAppConfigured()) {
    const status = !recipient ? 'INVALID_RECIPIENT' : 'NOT_CONFIGURED';
    const error = !recipient
      ? 'Student mobile number is missing or not a valid mobile'
      : 'WhatsApp credentials are not configured (WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN)';
    const log = await prisma.messageLog.upsert({
      where: { dedupeKey: args.dedupeKey },
      create: { ...base, dedupeKey: args.dedupeKey, recipient, status, error },
      update: { ...base, recipient, status, error },
    });
    return { outcome: status, logId: log.id, error };
  }

  // Claim the send. The unique dedupeKey means two concurrent runs cannot both claim it.
  let logId: string;
  if (!existing) {
    try {
      const created = await prisma.messageLog.create({
        data: { ...base, dedupeKey: args.dedupeKey, recipient, status: 'PENDING', attempts: 1 },
      });
      logId = created.id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return { outcome: 'DUPLICATE' };
      throw err;
    }
  } else {
    const claimed = await prisma.messageLog.updateMany({
      where: { id: existing.id, status: existing.status, updatedAt: existing.updatedAt },
      data: { ...base, recipient, status: 'PENDING', attempts: { increment: 1 }, error: null },
    });
    if (claimed.count === 0) return { outcome: 'DUPLICATE', logId: existing.id };
    logId = existing.id;
  }

  const result = await sendWhatsAppTemplate(recipient, args.templateName, args.params);
  if (result.ok) {
    await prisma.messageLog.update({
      where: { id: logId },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        providerMessageId: result.id ?? null,
        providerResponse: json(result.response),
        error: null,
      },
    });
    return { outcome: 'SENT', logId };
  }
  await prisma.messageLog.update({
    where: { id: logId },
    data: { status: 'FAILED', providerResponse: json(result.response), error: result.error ?? 'Send failed' },
  });
  return { outcome: 'FAILED', logId, rateLimited: result.rateLimited, error: result.error };
}

/** Delivery receipts from the WhatsApp webhook → update the matching log row. */
export async function applyDeliveryStatus(providerMessageId: string, status: string, errorText?: string) {
  const map: Record<string, string> = { sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED' };
  const next = map[status];
  if (!next) return;
  const rank: Record<string, number> = { PENDING: 0, SENT: 1, DELIVERED: 2, READ: 3 };
  const logs = await prisma.messageLog.findMany({ where: { providerMessageId } });
  for (const log of logs) {
    // Receipts can arrive out of order — never move a message backwards (READ → DELIVERED).
    if (next !== 'FAILED' && (rank[log.status] ?? 0) >= rank[next]) continue;
    await prisma.messageLog.update({
      where: { id: log.id },
      data: { status: next, error: next === 'FAILED' ? errorText ?? 'Delivery failed' : log.error },
    });
  }
}

/** Payment confirmation — only when an approved template name is configured. */
export async function notifyPaymentReceived(a: {
  paymentId: string;
  studentId: string;
  studentName: string;
  mobile: string;
  amountRupees: number;
  invoiceNo: string;
  balanceRupees: number;
}): Promise<SendOutcome | null> {
  if (!env.WHATSAPP_PAYMENT_TEMPLATE) return null;
  const money = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2 });
  return sendLoggedTemplate({
    event: 'PAYMENT_RECEIVED',
    dedupeKey: `payment:${a.paymentId}`,
    studentId: a.studentId,
    mobile: a.mobile,
    templateName: env.WHATSAPP_PAYMENT_TEMPLATE,
    params: [a.studentName, money(a.amountRupees), a.invoiceNo, money(a.balanceRupees)],
    triggeredBy: 'SYSTEM',
  });
}

/** Admission confirmation — only when an approved template name is configured. */
export async function notifyAdmission(a: {
  enrollmentId: string;
  studentId: string;
  studentName: string;
  mobile: string;
  courseLabel: string;
  startDate: string;
}): Promise<SendOutcome | null> {
  if (!env.WHATSAPP_ADMISSION_TEMPLATE) return null;
  return sendLoggedTemplate({
    event: 'ADMISSION_CONFIRMATION',
    dedupeKey: `admission:${a.enrollmentId}`,
    studentId: a.studentId,
    enrollmentId: a.enrollmentId,
    mobile: a.mobile,
    templateName: env.WHATSAPP_ADMISSION_TEMPLATE,
    params: [a.studentName, a.courseLabel, a.startDate],
    triggeredBy: 'SYSTEM',
  });
}

/**
 * The reminder window an enrolment is currently in: the smallest configured
 * offset that is >= days remaining. One reminder is sent per window, so a missed
 * cron day still sends that window's reminder once rather than skipping it.
 */
export function currentReminderWindow(daysRemaining: number, offsets: number[]): number | null {
  if (daysRemaining < 0) return null;
  const eligible = offsets.filter((o) => daysRemaining <= o);
  return eligible.length ? Math.min(...eligible) : null;
}

export const renewalDedupeKey = (enrollmentId: string, endDate: string, window: number) =>
  `renewal:${enrollmentId}:${endDate}:${window}`;
