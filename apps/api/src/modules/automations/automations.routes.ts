import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../lib/env.js';
import { asyncHandler, HttpError } from '../../lib/http.js';
import { reminderOffsets } from '../../lib/dates.js';
import { isWhatsAppConfigured } from '../../lib/whatsappSend.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { runReminders, sendRenewalReminder } from '../../jobs/reminders.js';

export const automationsRouter = Router();
automationsRouter.use(requireAuth);

const manage = requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER');

// Run the renewal + low-stock reminder pass on demand (the cron runs it daily).
automationsRouter.post(
  '/run-reminders',
  manage,
  asyncHandler(async (req, res) => {
    const summary = await runReminders(`MANUAL:${req.user!.sub}`);
    res.json({ ok: true, summary });
  }),
);

// What is (and is not) set up — names only, never credential values.
automationsRouter.get(
  '/whatsapp-status',
  asyncHandler(async (_req, res) => {
    res.json({
      ok: true,
      whatsapp: {
        configured: isWhatsAppConfigured(),
        reminderDays: reminderOffsets(),
        renewalTemplate: env.WHATSAPP_RENEWAL_TEMPLATE,
        paymentTemplate: env.WHATSAPP_PAYMENT_TEMPLATE ?? null,
        admissionTemplate: env.WHATSAPP_ADMISSION_TEMPLATE ?? null,
        webhookSignatureConfigured: !!env.WHATSAPP_APP_SECRET,
      },
    });
  }),
);

// Send the current-window renewal reminder for one enrolment (deduplicated like the cron).
automationsRouter.post(
  '/renewal-reminder/:enrollmentId',
  manage,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.enrollmentId);
    if (!id.success) throw new HttpError(400, 'Invalid enrollment id');
    const enr = await prisma.enrollment.findUnique({
      where: { id: id.data },
      include: { student: true, coursePlan: { include: { course: true } } },
    });
    if (!enr) throw new HttpError(404, 'Enrollment not found');
    if (enr.status !== 'ACTIVE') throw new HttpError(409, 'Reminders are only sent for current enrolments');
    const result = await sendRenewalReminder(enr, `MANUAL:${req.user!.sub}`);
    if (!result) {
      throw new HttpError(
        409,
        `This enrolment is not inside a reminder window (reminders go out ${reminderOffsets().join(', ')} day(s) before expiry)`,
      );
    }
    const log = result.logId ? await prisma.messageLog.findUnique({ where: { id: result.logId } }) : null;
    res.json({ ok: true, outcome: result.outcome, error: result.error ?? null, log });
  }),
);

// Message log: trigger, recipient, timestamp, provider response, status.
automationsRouter.get(
  '/messages',
  manage,
  asyncHandler(async (req, res) => {
    const q = z
      .object({
        studentId: z.string().uuid().optional(),
        enrollmentId: z.string().uuid().optional(),
        status: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(req.query);
    const messages = await prisma.messageLog.findMany({
      where: { studentId: q.studentId, enrollmentId: q.enrollmentId, status: q.status },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    });
    res.json({ ok: true, messages });
  }),
);
