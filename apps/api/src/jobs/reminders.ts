import { pathToFileURL } from 'node:url';
import { prisma } from '../lib/prisma.js';
import { env } from '../lib/env.js';
import { notify } from '../lib/notify.js';
import { sendWhatsAppTemplate } from '../lib/whatsappSend.js';

const DAY = 86_400_000;
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

export interface ReminderSummary {
  renewalsChecked: number;
  renewalNotifications: number;
  whatsappSent: number;
  whatsappSkipped: number;
  lowStockNotifications: number;
}

/**
 * Daily automation (run by Render Cron: `node dist/jobs/reminders.js`).
 * 1) Renewal reminders — WhatsApp template + RENEWAL_DUE notification for enrollments
 *    ending within the configured offsets (deduped once per day per enrollment).
 * 2) Low-stock — LOW_STOCK notification for variants at/below reorder level.
 */
export async function runReminders(): Promise<ReminderSummary> {
  const offsets = env.RENEWAL_REMINDER_DAYS.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n));
  const maxOffset = Math.max(...offsets, 1);
  const summary: ReminderSummary = {
    renewalsChecked: 0,
    renewalNotifications: 0,
    whatsappSent: 0,
    whatsappSkipped: 0,
    lowStockNotifications: 0,
  };

  const until = new Date(Date.now() + (maxOffset + 1) * DAY);
  const enrollments = await prisma.enrollment.findMany({
    where: { status: 'ACTIVE', endDate: { lte: until } },
    include: { student: true, coursePlan: { include: { course: true } } },
  });

  for (const enr of enrollments) {
    summary.renewalsChecked++;
    const daysLeft = Math.ceil((enr.endDate.getTime() - Date.now()) / DAY);
    const dueToday = offsets.includes(daysLeft) || daysLeft <= 0;
    if (!dueToday) continue;

    // Dedup: at most one renewal notification per enrollment per day.
    const already = await prisma.notification.findFirst({
      where: { type: 'RENEWAL_DUE', entity: 'enrollment', entityId: enr.id, createdAt: { gte: startOfToday() } },
    });
    if (already) continue;

    const endStr = enr.endDate.toISOString().slice(0, 10);
    await notify({
      type: 'RENEWAL_DUE',
      title: `Renewal due: ${enr.student.fullName}`,
      body: `${enr.coursePlan.course.name} — ${enr.coursePlan.title} ends ${endStr} (${daysLeft <= 0 ? 'expired' : `${daysLeft}d left`})`,
      roleTarget: 'ADMIN',
      entity: 'enrollment',
      entityId: enr.id,
    });
    summary.renewalNotifications++;

    if (enr.student.mobile) {
      const res = await sendWhatsAppTemplate(enr.student.mobile, env.WHATSAPP_RENEWAL_TEMPLATE, [
        enr.student.fullName,
        `${enr.coursePlan.course.name} (${enr.coursePlan.title})`,
        endStr,
      ]);
      if (res.ok) summary.whatsappSent++;
      else summary.whatsappSkipped++;
    }
  }

  // Low-stock notifications
  const variants = await prisma.productVariant.findMany({ include: { product: true } });
  for (const v of variants.filter((x) => x.stockQty <= x.reorderLevel)) {
    const already = await prisma.notification.findFirst({
      where: { type: 'LOW_STOCK', entity: 'variant', entityId: v.id, createdAt: { gte: startOfToday() } },
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
