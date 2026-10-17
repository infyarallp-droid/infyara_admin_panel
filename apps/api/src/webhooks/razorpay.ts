import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/http.js';
import { verifyWebhookSignature, type RzpPayment } from '../lib/razorpay.js';
import { processGatewayPayment, processRefundEvent } from '../modules/payments/payments.service.js';

// Razorpay webhooks: payment.captured, payment.authorized, payment.failed, order.paid,
// refund.processed, refund.failed. Configure in Dashboard → Accounts & Settings → Webhooks.
export const razorpayRouter = Router();

razorpayRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    const valid = !!raw && verifyWebhookSignature(raw, req.headers['x-razorpay-signature'] as string | undefined);
    const eventId = (req.headers['x-razorpay-event-id'] as string | undefined) ?? null;

    if (!valid) {
      await prisma.webhookEvent.create({
        data: { channel: 'razorpay', rawPayload: { event: req.body?.event ?? null }, signatureValid: false, error: 'Invalid signature' },
      });
      return res.sendStatus(400);
    }

    // Idempotency: Razorpay retries and may deliver an event more than once.
    const logId = crypto.randomUUID();
    const { count } = await prisma.webhookEvent.createMany({
      skipDuplicates: true, // ON CONFLICT DO NOTHING on the event id
      data: [{ id: logId, channel: 'razorpay', rawPayload: req.body ?? {}, signatureValid: true, externalEventId: eventId }],
    });
    if (!count) return res.json({ ok: true, duplicate: true });

    try {
      const event: string = req.body?.event ?? '';
      const payment: RzpPayment | undefined = req.body?.payload?.payment?.entity;
      if (payment && ['payment.captured', 'payment.authorized', 'payment.failed', 'order.paid'].includes(event)) {
        const order = payment.order_id ? await prisma.paymentOrder.findUnique({ where: { gatewayOrderId: payment.order_id } }) : null;
        if (order) await processGatewayPayment(order, payment);
      }
      const refund = req.body?.payload?.refund?.entity;
      if (refund && (event === 'refund.processed' || event === 'refund.failed' || event === 'refund.created')) {
        await processRefundEvent(refund);
      }
      await prisma.webhookEvent.update({ where: { id: logId }, data: { processed: true } });
      res.json({ ok: true });
    } catch (err) {
      // Not processed: release the id so Razorpay's retry is handled, and answer 500 so it retries.
      await prisma.webhookEvent.update({
        where: { id: logId },
        data: { error: (err as Error).message.slice(0, 500), externalEventId: null },
      });
      console.error('[razorpay] webhook processing failed', err);
      res.sendStatus(500);
    }
  }),
);
