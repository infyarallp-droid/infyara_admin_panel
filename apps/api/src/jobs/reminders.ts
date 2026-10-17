import { pathToFileURL } from 'node:url';
import { diffDaysISO } from '@moksha/shared';
import { prisma } from '../lib/prisma.js';
import { env } from '../lib/env.js';
import { notify } from '../lib/notify.js';
import { addDaysISO, dateOnly, reminderOffsets, today, toISODate } from '../lib/dates.js';
import { isWhatsAppConfigured } from '../lib/whatsappSend.js';
import {
  currentReminderWindow,
  renewalDedupeKey,
  sendLoggedTemplate,
  type SendOutcome,
} from '../modules/messaging/messaging.service.js';
import { enabledRules } from '../modules/messaging/rules.service.js';

export interface ReminderSummary {
  renewalsChecked: number;
  renewalNotifications: number;
  whatsappConfigured: boolean;
  whatsappSent: number;
  /** Already sent for this enrolment + reminder window — not sent again. */
  whatsappDuplicate: number;
  whatsappFailed: number;
  /** Not sent because credentials are missing (logged as NOT_CONFIGURED). */
  whatsappNotConfigured: number;
  whatsappInvalidRecipient: number;
  /** Not sent: no recorded WhatsApp opt-in for the student's number. */
  whatsappNoConsent: number;
  /** Kept for backwards compatibility: everything that was not sent. */
  whatsappSkipped: number;
  rateLimited: boolean;
  lowStockNotifications: number;
}

interface ReminderTarget {
  id: string;
  endDate: Date;
  studentId: string;
  student: { fullName: string; mobile: string; status: string };
  coursePlan: { title: string; course: { name: string } };
}

/** Send (once per window) the renewal reminder for one enrolment. Null = not in any reminder window. */
export async function sendRenewalReminder(enr: ReminderTarget, triggeredBy: string): Promise<SendOutcome | null> {
  const endStr = toISODate(enr.endDate);
  const window = currentReminderWindow(diffDaysISO(endStr, today()), reminderOffsets());
  if (window == null) return null;
  return sendLoggedTemplate({
    event: 'RENEWAL_REMINDER',
    dedupeKey: renewalDedupeKey(enr.id, endStr, window),
    studentId: enr.studentId,
    enrollmentId: enr.id,
    mobile: enr.student.mobile,
    templateName: env.WHATSAPP_RENEWAL_TEMPLATE,
    params: [enr.student.fullName, `${enr.coursePlan.course.name} (${enr.coursePlan.title})`, endStr],
    triggeredBy,
  });
}

/**
 * Daily automation (run by Render Cron: `node dist/jobs/reminders.js`).
 * 1) Renewal reminders — WhatsApp template (once per enrolment per reminder window)
 *    + RENEWAL_DUE in-app notification (once per day per enrolment).
 * 2) Low-stock — LOW_STOCK notification for variants at/below reorder level.
 */
export async function runReminders(triggeredBy = 'CRON'): Promise<ReminderSummary> {
  const offsets = reminderOffsets();
  const maxOffset = Math.max(...offsets, 1);
  const todayStr = today();
  const startOfToday = dateOnly(todayStr);
  const summary: ReminderSummary = {
    renewalsChecked: 0,
    renewalNotifications: 0,
    whatsappConfigured: isWhatsAppConfigured(),
    whatsappSent: 0,
    whatsappDuplicate: 0,
    whatsappFailed: 0,
    whatsappNotConfigured: 0,
    whatsappInvalidRecipient: 0,
    whatsappNoConsent: 0,
    whatsappSkipped: 0,
    rateLimited: false,
    lowStockNotifications: 0,
  };

  const renewalRuleActive = (await enabledRules('ENROLLMENT_EXPIRY')).length > 0;
  const enrollments = await prisma.enrollment.findMany({
    where: { status: 'ACTIVE', endDate: { lte: dateOnly(addDaysISO(todayStr, maxOffset)) } },
    include: { student: true, coursePlan: { include: { course: true } } },
  });

  for (const enr of enrollments) {
    summary.renewalsChecked++;
    if (enr.student.status === 'INACTIVE') continue; // manually deactivated students are not chased

    const endStr = toISODate(enr.endDate);
    const daysLeft = diffDaysISO(endStr, todayStr);
    const dueToday = offsets.includes(daysLeft) || daysLeft <= 0;

    if (dueToday) {
      // Dedup: at most one in-app renewal notification per enrollment per day.
      const already = await prisma.notification.findFirst({
        where: { type: 'RENEWAL_DUE', entity: 'enrollment', entityId: enr.id, createdAt: { gte: startOfToday } },
      });
      if (!already) {
        await notify({
          type: 'RENEWAL_DUE',
          title: `Renewal due: ${enr.student.fullName}`,
          body: `${enr.coursePlan.course.name} — ${enr.coursePlan.title} ends ${endStr} (${daysLeft < 0 ? 'expired' : `${daysLeft}d left`})`,
          roleTarget: 'ADMIN',
          entity: 'enrollment',
          entityId: enr.id,
        });
        summary.renewalNotifications++;
      }
    }

    // After a rate-limit response, stop calling the provider for this run; the
    // unsent reminders stay un-logged and are picked up by the next run.
    if (summary.rateLimited) continue;
    // An enabled "Renewal reminder" rule (WhatsApp → Rules) replaces this built-in reminder.
    if (renewalRuleActive) continue;
    const result = await sendRenewalReminder(enr, triggeredBy);
    if (!result) continue;
    if (result.outcome === 'SENT') summary.whatsappSent++;
    else {
      summary.whatsappSkipped++;
      if (result.outcome === 'DUPLICATE') summary.whatsappDuplicate++;
      else if (result.outcome === 'NOT_CONFIGURED') summary.whatsappNotConfigured++;
      else if (result.outcome === 'INVALID_RECIPIENT') summary.whatsappInvalidRecipient++;
      else if (result.outcome === 'NO_CONSENT') summary.whatsappNoConsent++;
      else summary.whatsappFailed++;
    }
    if (result.rateLimited) summary.rateLimited = true;
  }

  // Low-stock notifications
  const variants = await prisma.productVariant.findMany({ include: { product: true } });
  for (const v of variants.filter((x) => x.stockQty <= x.reorderLevel)) {
    const already = await prisma.notification.findFirst({
      where: { type: 'LOW_STOCK', entity: 'variant', entityId: v.id, createdAt: { gte: startOfToday } },
    });
    if (already) continue;
    await notify({
      type: 'LOW_STOCK',
      title: `Low stock: ${v.product.name} (${v.variantLabel})`,
      body: `${v.stockQty} left (reorder at ${v.reorderLevel})`,
      roleTarget: 'ADMIN',
      entity: 'variant',
      entityId: v.id,
    });
    summary.lowStockNotifications++;
  }

  return summary;
}

// CLI entry (Render Cron runs this file directly).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runReminders()
    .then((s) => {
      console.log('[reminders]', JSON.stringify(s));
      return prisma.$disconnect();
    })
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('[reminders] failed', e);
      process.exit(1);
    });
}
