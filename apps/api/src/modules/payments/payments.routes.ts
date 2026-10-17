import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../lib/env.js';
import { asyncHandler, HttpError } from '../../lib/http.js';
import { isRazorpayConfigured, razorpay, razorpayMode } from '../../lib/razorpay.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { toPaise } from '../billing/billing.service.js';
import { initiateRefund, processGatewayPayment, reconcileOpenOrders } from './payments.service.js';

// Admin: online payments (Razorpay orders, gateway payments, refunds).
export const paymentsRouter = Router();
paymentsRouter.use(requireAuth);

const view = requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTANT');
const refundRoles = requireRole('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT');

paymentsRouter.get(
  '/status',
  view,
  asyncHandler(async (_req, res) => {
    res.json({
      ok: true,
      razorpay: {
        configured: isRazorpayConfigured(),
        mode: razorpayMode(),
        webhookSecretSet: !!env.RAZORPAY_WEBHOOK_SECRET,
        webhookUrl: `${env.API_PUBLIC_URL.replace(/\/+$/, '')}/webhooks/razorpay`,
      },
    });
  }),
);

// GET /api/payments/orders?status=&q=&page=
paymentsRouter.get(
  '/orders',
  view,
  asyncHandler(async (req, res) => {
    const q = z
      .object({
        status: z.enum(['CREATED', 'ATTEMPTED', 'PAID', 'FAILED', 'EXPIRED', 'NEEDS_REVIEW']).optional(),
        q: z.string().trim().max(100).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25),
      })
      .parse(req.query);
    const where: Prisma.PaymentOrderWhereInput = {
      status: q.status,
      ...(q.q
        ? {
            OR: [
              { gatewayOrderId: { contains: q.q } },
              { description: { contains: q.q, mode: 'insensitive' } },
              { account: { fullName: { contains: q.q, mode: 'insensitive' } } },
              { account: { mobile: { contains: q.q } } },
              { transactions: { some: { gatewayPaymentId: { contains: q.q } } } },
            ],
          }
        : {}),
    };
    const [total, orders, sums] = await Promise.all([
      prisma.paymentOrder.count({ where }),
      prisma.paymentOrder.findMany({
        where,
        include: { account: { select: { id: true, fullName: true, mobile: true, studentId: true } }, transactions: { include: { refunds: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.paymentOrder.groupBy({ by: ['status'], _count: true, _sum: { amountPaise: true } }),
    ]);
    const refunded = await prisma.refund.aggregate({ _sum: { amountPaise: true }, where: { status: 'PROCESSED' } });
    res.json({
      ok: true,
      total,
      page: q.page,
      pageSize: q.pageSize,
      orders,
      summary: {
        byStatus: sums.map((s) => ({ status: s.status, count: s._count, amountPaise: s._sum.amountPaise ?? 0n })),
        refundedPaise: refunded._sum.amountPaise ?? 0n,
      },
    });
  }),
);

paymentsRouter.get(
  '/orders/:id',
  view,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw new HttpError(404, 'Order not found');
    const order = await prisma.paymentOrder.findUnique({
      where: { id: id.data },
      include: { account: true, transactions: { include: { refunds: { orderBy: { createdAt: 'desc' } } } } },
    });
    if (!order) throw new HttpError(404, 'Order not found');
    const invoice = order.invoiceId ? await prisma.invoice.findUnique({ where: { id: order.invoiceId }, select: { id: true, invoiceNo: true, status: true } }) : null;
    const { passwordHash: _ph, ...account } = order.account;
    res.json({ ok: true, order: { ...order, account }, invoice });
  }),
);

// POST /api/payments/orders/:id/sync — ask Razorpay for the latest state of this order now.
paymentsRouter.post(
  '/orders/:id/sync',
  view,
  asyncHandler(async (req, res) => {
    const order = await prisma.paymentOrder.findUnique({ where: { id: z.string().uuid().parse(req.params.id) } });
    if (!order) throw new HttpError(404, 'Order not found');
    const { items } = await razorpay.fetchOrderPayments(order.gatewayOrderId);
    let latest = order;
    for (const p of items) latest = await processGatewayPayment(order, p);
    res.json({ ok: true, order: latest, gatewayPayments: items.length });
  }),
);

paymentsRouter.post(
  '/reconcile',
  view,
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, summary: await reconcileOpenOrders(50) });
  }),
);

// POST /api/payments/gateway-payments/:id/refund  { amountRupees, reason }
paymentsRouter.post(
  '/gateway-payments/:id/refund',
  refundRoles,
  asyncHandler(async (req, res) => {
    const input = z
      .object({ amountRupees: z.number().positive(), reason: z.string().trim().min(3, 'Give a reason for the refund').max(300) })
      .parse(req.body);
    const refund = await initiateRefund({
      gatewayPaymentId: z.string().uuid().parse(req.params.id),
      amountPaise: toPaise(input.amountRupees, 'Refund amount'),
      reason: input.reason,
      userId: req.user!.sub,
    });
    res.status(201).json({ ok: true, refund });
  }),
);
