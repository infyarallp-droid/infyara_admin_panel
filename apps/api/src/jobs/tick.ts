import { pathToFileURL } from 'node:url';
import { prisma } from '../lib/prisma.js';
import { today } from '../lib/dates.js';
import { isRazorpayConfigured } from '../lib/razorpay.js';
import { deliverQueued, evaluateTimeRules } from '../modules/messaging/rules.service.js';
import { reconcileOpenOrders } from '../modules/payments/payments.service.js';
import { runReminders } from './reminders.js';

// The job runner. Safe to run as often as you like and from several places at
// once: every step is idempotent (dedupe keys, row locks, once-per-day markers).
// Triggered by POST /internal/jobs/tick (Render Cron / cron-job.org every 5 min),
// by `node dist/jobs/tick.js`, or in-process when INTERNAL_SCHEDULER_SECONDS > 0.

/** Claim a once-per-day job: true only for the first caller on a given business date. */
async function claimDaily(key: string): Promise<boolean> {
  const day = today();
  const rows = await prisma.$queryRaw<{ key: string }[]>`
    INSERT INTO "job_markers" ("key", "value", "updated_at") VALUES (${key}, ${day}, NOW())
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updated_at" = NOW()
    WHERE "job_markers"."value" IS DISTINCT FROM EXCLUDED."value"
    RETURNING "key"`;
  return rows.length > 0;
}

export async function runTick() {
  const started = Date.now();
  const result: Record<string, unknown> = {};
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      result[name] = await fn();
    } catch (err) {
      console.error(`[tick] ${name} failed`, err);
      result[name] = { error: (err as Error).message };
    }
  };

  await step('dailyReminders', async () => ((await claimDaily('daily-reminders')) ? runReminders('CRON') : 'already ran today'));
  await step('rules', evaluateTimeRules);
  await step('delivery', () => deliverQueued(60));
  if (isRazorpayConfigured()) await step('payments', () => reconcileOpenOrders(20));
  await prisma.jobMarker.upsert({
    where: { key: 'last-tick' },
    create: { key: 'last-tick', value: new Date().toISOString() },
    update: { value: new Date().toISOString() },
  });
  return { ...result, ms: Date.now() - started };
}

let running = false;
/** In-process trigger for always-on instances; overlapping runs are skipped. */
export function startInternalScheduler(seconds: number) {
  const tick = () => {
    if (running) return;
    running = true;
    runTick()
      .catch((e) => console.error('[tick] failed', e))
      .finally(() => {
        running = false;
      });
  };
  setTimeout(tick, 15_000).unref();
  setInterval(tick, seconds * 1000).unref();
  console.log(`⏱  Internal scheduler: job runner every ${seconds}s`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runTick()
    .then((s) => {
      console.log('[tick]', JSON.stringify(s));
      return prisma.$disconnect();
    })
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('[tick] failed', e);
      process.exit(1);
    });
}
