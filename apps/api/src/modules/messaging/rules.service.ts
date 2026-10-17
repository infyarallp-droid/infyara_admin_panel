import { Prisma, type MessageLog, type ReminderRule, type WhatsAppTemplate } from '@prisma/client';
import { fillPlaceholders, type ReminderTrigger } from '@moksha/shared';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../lib/env.js';
import { addDaysISO, dateOnly, today, toISODate } from '../../lib/dates.js';
import { isWhatsAppConfigured, sendWhatsAppTemplate, toWhatsAppRecipient } from '../../lib/whatsappSend.js';
import { mayMessage } from './consent.service.js';
import { sendLoggedTemplate, type SendOutcome } from './messaging.service.js';

// Admin-configured reminder rules + the outbox of queued/scheduled WhatsApp messages.
// Everything is stored in message_logs, so nothing depends on in-memory timers:
// the job runner (POST /internal/jobs/tick) sends whatever is due.

const money = (paise: bigint | number) => (Number(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });

export interface PlaceholderContext {
  student: { fullName: string };
  enrollment?: { startDate: Date; endDate: Date; coursePlan: { title: string; course: { name: string } } } | null;
  invoice?: { invoiceNo: string; totalPaise: bigint; amountPaidPaise: bigint; dueDate: Date | null } | null;
  amountPaise?: bigint | null;
}

export function placeholderValues(ctx: PlaceholderContext): Record<string, string> {
  const v: Record<string, string> = {
    name: ctx.student.fullName,
    first_name: ctx.student.fullName.split(/\s+/)[0] ?? ctx.student.fullName,
  };
  if (ctx.enrollment) {
    v.course = `${ctx.enrollment.coursePlan.course.name} (${ctx.enrollment.coursePlan.title})`;
    v.start_date = toISODate(ctx.enrollment.startDate);
    v.end_date = toISODate(ctx.enrollment.endDate);
  }
  if (ctx.invoice) {
    v.invoice_no = ctx.invoice.invoiceNo;
    v.balance = money(ctx.invoice.totalPaise - ctx.invoice.amountPaidPaise);
    v.amount = money(ctx.invoice.totalPaise);
    v.due_date = ctx.invoice.dueDate ? toISODate(ctx.invoice.dueDate) : '';
  }
  if (ctx.amountPaise != null) v.amount = money(ctx.amountPaise);
  return v;
}

/** Placeholders for a student's current situation (latest enrolment, oldest unpaid invoice). */
export async function studentPlaceholderValues(studentId: string) {
  const student = await prisma.student.findUniqueOrThrow({ where: { id: studentId } });
  const [enrollment, invoice] = await Promise.all([
    prisma.enrollment.findFirst({
      where: { studentId, status: 'ACTIVE' },
      include: { coursePlan: { include: { course: true } } },
      orderBy: { endDate: 'desc' },
    }),
    prisma.invoice.findFirst({ where: { studentId, status: { in: ['UNPAID', 'PARTIAL'] } }, orderBy: { createdAt: 'asc' } }),
  ]);
  return { student, values: placeholderValues({ student, enrollment, invoice }) };
}

type RuleWithTemplate = ReminderRule & { template: WhatsAppTemplate };

export async function enabledRules(trigger: ReminderTrigger): Promise<RuleWithTemplate[]> {
  return prisma.reminderRule.findMany({
    where: { trigger, isEnabled: true, template: { status: 'APPROVED' } },
    include: { template: true },
  });
}

/** Queue a message for the job runner. The dedupe key makes re-queueing the same reminder a no-op. */
export async function enqueueMessage(args: {
  dedupeKey: string;
  event: 'RULE' | 'CAMPAIGN';
  template: WhatsAppTemplate;
  params: string[];
  studentId: string;
  mobile: string;
  enrollmentId?: string | null;
  ruleId?: string | null;
  campaignId?: string | null;
  scheduledFor?: Date;
  triggeredBy: string;
}): Promise<MessageLog | null> {
  // ON CONFLICT DO NOTHING: an already queued/sent reminder is skipped without an error.
  const { count } = await prisma.messageLog.createMany({
    skipDuplicates: true,
    data: [
      {
        dedupeKey: args.dedupeKey,
        event: args.event,
        studentId: args.studentId,
        enrollmentId: args.enrollmentId ?? null,
        recipient: toWhatsAppRecipient(args.mobile),
        templateName: args.template.name,
        templateId: args.template.id,
        params: args.params,
        ruleId: args.ruleId ?? null,
        campaignId: args.campaignId ?? null,
        status: 'QUEUED',
        scheduledFor: args.scheduledFor ?? new Date(),
        triggeredBy: args.triggeredBy,
      },
    ],
  });
  return count ? prisma.messageLog.findUnique({ where: { dedupeKey: args.dedupeKey } }) : null;
}

// ───────────────────────── Event rules (sent immediately) ─────────────────────────

/**
 * Run the enabled rules for an event (enrolment created / payment received).
 * Returns null when no rule is enabled, so the caller can fall back to the
 * original env-configured template.
 */
export async function fireEventRules(
  trigger: 'ENROLLMENT_CREATED' | 'PAYMENT_RECEIVED',
  ctx: PlaceholderContext & { studentId: string; mobile: string; entityId: string; enrollmentId?: string | null },
): Promise<SendOutcome[] | null> {
  const rules = await enabledRules(trigger);
  if (!rules.length) return null;
  const values = placeholderValues(ctx);
  const outcomes: SendOutcome[] = [];
  for (const rule of rules) {
    outcomes.push(
      await sendLoggedTemplate({
        event: 'RULE',
        dedupeKey: `rule:${rule.id}:${ctx.entityId}`,
        studentId: ctx.studentId,
        enrollmentId: ctx.enrollmentId ?? null,
        mobile: ctx.mobile,
        templateName: rule.template.name,
        language: rule.template.language,
        templateId: rule.template.id,
        ruleId: rule.id,
        params: fillPlaceholders(rule.params as string[], values),
        triggeredBy: 'SYSTEM',
      }),
    );
  }
  return outcomes;
}

// ───────────────────────── Time-based rules (queued by the job runner) ─────────────────────────

/** How far back a missed reminder is still worth sending (e.g. after a few days of downtime). */
const CATCH_UP_DAYS = 3;

export async function evaluateTimeRules(): Promise<{ rules: number; queued: number }> {
  const todayStr = today();
  let queued = 0;
  const rules = await prisma.reminderRule.findMany({
    where: { isEnabled: true, trigger: { in: ['ENROLLMENT_EXPIRY', 'ENROLLMENT_START', 'INVOICE_DUE'] }, template: { status: 'APPROVED' } },
    include: { template: true },
  });

  for (const rule of rules) {
    const params = rule.params as string[];
    // The reminder is due on (event date − offset). Send once, on or within a few days after that date.
    const eventFrom = dateOnly(addDaysISO(todayStr, rule.offsetDays - CATCH_UP_DAYS));
    const eventTo = dateOnly(addDaysISO(todayStr, rule.offsetDays));

    if (rule.trigger === 'ENROLLMENT_EXPIRY' || rule.trigger === 'ENROLLMENT_START') {
      const field = rule.trigger === 'ENROLLMENT_EXPIRY' ? 'endDate' : 'startDate';
      // Any date from today up to (today + offset) that has not had this reminder yet: a rule
      // switched on late, or a missed run, still sends it once — never for dates already past.
      const range = { gte: dateOnly(todayStr), lte: eventTo };
      const enrollments = await prisma.enrollment.findMany({
        where: {
          status: 'ACTIVE',
          ...(field === 'endDate' ? { endDate: range, renewal: { is: null } } : { startDate: range }),
          student: { status: 'ACTIVE' },
        },
        include: { student: true, coursePlan: { include: { course: true } } },
      });
      for (const e of enrollments) {
        const date = toISODate(field === 'endDate' ? e.endDate : e.startDate);
        const log = await enqueueMessage({
          dedupeKey: `rule:${rule.id}:${e.id}:${date}`,
          event: 'RULE',
          template: rule.template,
          params: fillPlaceholders(params, placeholderValues({ student: e.student, enrollment: e })),
          studentId: e.studentId,
          enrollmentId: e.id,
          mobile: e.student.mobile,
          ruleId: rule.id,
          triggeredBy: 'RULE',
        });
        if (log) queued++;
      }
    }

    if (rule.trigger === 'INVOICE_DUE') {
      const invoices = await prisma.invoice.findMany({
        where: { status: { in: ['UNPAID', 'PARTIAL'] }, dueDate: { gte: eventFrom, lte: eventTo }, student: { is: { status: 'ACTIVE' } } },
        include: { student: true },
      });
      for (const inv of invoices) {
        if (!inv.student) continue;
        const log = await enqueueMessage({
          dedupeKey: `rule:${rule.id}:${inv.id}:${toISODate(inv.dueDate!)}`,
          event: 'RULE',
          template: rule.template,
          params: fillPlaceholders(params, placeholderValues({ student: inv.student, invoice: inv })),
          studentId: inv.student.id,
          mobile: inv.student.mobile,
          ruleId: rule.id,
          triggeredBy: 'RULE',
        });
        if (log) queued++;
      }
    }
  }
  return { rules: rules.length, queued };
}

// ───────────────────────── Outbox delivery ─────────────────────────

/** Retry delay after a temporary failure: 5, 20, 45 … minutes. */
const backoffMs = (attempts: number) => Math.min(attempts * attempts * 5 * 60_000, 6 * 3_600_000);

export interface DeliverySummary {
  claimed: number;
  sent: number;
  failed: number;
  retrying: number;
  noConsent: number;
  notConfigured: number;
  invalidRecipient: number;
  rateLimited: boolean;
}

/** Send queued messages whose time has come. Concurrent runners never pick the same row. */
export async function deliverQueued(limit = 40): Promise<DeliverySummary> {
  const summary: DeliverySummary = { claimed: 0, sent: 0, failed: 0, retrying: 0, noConsent: 0, notConfigured: 0, invalidRecipient: 0, rateLimited: false };
  if (!isWhatsAppConfigured()) {
    // Leave everything queued; it goes out once credentials are added. Nothing is marked as sent.
    return summary;
  }
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "message_logs" SET "status" = 'PENDING', "attempts" = "attempts" + 1, "updated_at" = NOW()
    WHERE "id" IN (
      SELECT "id" FROM "message_logs"
      WHERE "status" = 'QUEUED' AND "scheduled_for" <= NOW()
      ORDER BY "scheduled_for" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id"`;
  summary.claimed = rows.length;

  for (const { id } of rows) {
    const log = await prisma.messageLog.findUniqueOrThrow({ where: { id } });
    if (summary.rateLimited) {
      await prisma.messageLog.update({ where: { id }, data: { status: 'QUEUED', attempts: { decrement: 1 }, scheduledFor: new Date(Date.now() + 15 * 60_000) } });
      continue;
    }
    const student = log.studentId ? await prisma.student.findUnique({ where: { id: log.studentId } }) : null;
    const mobile = student?.mobile ?? null;
    if (!(await mayMessage(mobile))) {
      await prisma.messageLog.update({ where: { id }, data: { status: 'NO_CONSENT', error: 'No WhatsApp opt-in recorded for this number' } });
      summary.noConsent++;
      continue;
    }
    const recipient = toWhatsAppRecipient(mobile);
    if (!recipient) {
      await prisma.messageLog.update({ where: { id }, data: { status: 'INVALID_RECIPIENT', error: 'Student mobile number is missing or not a valid mobile' } });
      summary.invalidRecipient++;
      continue;
    }
    const template = log.templateId ? await prisma.whatsAppTemplate.findUnique({ where: { id: log.templateId } }) : null;
    if (template && template.status !== 'APPROVED') {
      await prisma.messageLog.update({ where: { id }, data: { status: 'FAILED', error: `Template "${template.name}" is ${template.status} in Meta` } });
      summary.failed++;
      continue;
    }
    const result = await sendWhatsAppTemplate(recipient, log.templateName ?? '', (log.params as string[]) ?? [], template?.language);
    const response = result.response == null ? Prisma.JsonNull : (result.response as Prisma.InputJsonValue);
    if (result.ok) {
      await prisma.messageLog.update({
        where: { id },
        data: { status: 'SENT', recipient, sentAt: new Date(), providerMessageId: result.id ?? null, providerResponse: response, error: null },
      });
      summary.sent++;
    } else if (result.skipped) {
      await prisma.messageLog.update({ where: { id }, data: { status: 'QUEUED', attempts: { decrement: 1 } } });
      summary.notConfigured++;
    } else if (result.retryable && log.attempts < env.WHATSAPP_MAX_ATTEMPTS) {
      await prisma.messageLog.update({
        where: { id },
        data: { status: 'QUEUED', scheduledFor: new Date(Date.now() + backoffMs(log.attempts)), providerResponse: response, error: result.error ?? 'Send failed' },
      });
      summary.retrying++;
      if (result.rateLimited) summary.rateLimited = true;
    } else {
      await prisma.messageLog.update({ where: { id }, data: { status: 'FAILED', providerResponse: response, error: result.error ?? 'Send failed' } });
      summary.failed++;
    }
  }
  return summary;
}
