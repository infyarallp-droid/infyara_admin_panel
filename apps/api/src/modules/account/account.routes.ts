import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { WHATSAPP_CONSENT_TEXT, accountProfileSchema, passwordSchema } from '@moksha/shared';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../lib/env.js';
import { asyncHandler, HttpError } from '../../lib/http.js';
import { clientIp, hit } from '../../lib/rateLimit.js';
import { requireISODate, today } from '../../lib/dates.js';
import { verifyGoogleIdToken } from '../../lib/google.js';
import { isRazorpayConfigured, razorpayMode } from '../../lib/razorpay.js';
import { requireCustomer } from '../../middleware/customerAuth.js';
import { buildInvoicePdf, buildReceiptPdf } from '../billing/billing.service.js';
import { enrollInclude, presentEnrollment } from '../enrollments/enrollments.service.js';
import { currentConsent, recordConsent } from '../messaging/consent.service.js';
import { presentAccount } from '../customer-auth/customerAuth.service.js';
import { createInvoiceOrder, createPlanOrder, markAttempted, verifyCheckout } from '../payments/payments.service.js';

// Student self-service, called by the website's server on behalf of a signed-in visitor.
// Every query is scoped to req.customer — ids in the request are only ever looked up
// inside that account's own records.
export const accountRouter = Router();
accountRouter.use(requireCustomer);

const uuid = (v: string, what = 'record') => {
  const p = z.string().uuid().safeParse(v);
  if (!p.success) throw new HttpError(404, `${what} not found`);
  return p.data;
};

const loadAccount = (id: string) => prisma.customerAccount.findUniqueOrThrow({ where: { id }, include: { identities: true } });

// GET /api/account — profile + preferences
accountRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const account = await loadAccount(req.customer!.id);
    const student = account.studentId
      ? await prisma.student.findUnique({ where: { id: account.studentId }, select: { fullName: true, studentCode: true } })
      : null;
    res.json({
      ok: true,
      account: presentAccount(account),
      student,
      whatsapp: { optedIn: (await currentConsent(account.mobile)) === 'OPTED_IN', consentText: WHATSAPP_CONSENT_TEXT },
      payments: { enabled: isRazorpayConfigured(), mode: razorpayMode(), keyId: env.RAZORPAY_KEY_ID ?? null },
    });
  }),
);

accountRouter.patch(
  '/profile',
  asyncHandler(async (req, res) => {
    const input = accountProfileSchema.parse(req.body);
    // The email is also a sign-in name, so it must not belong to another account.
    if (input.email) {
      const other = await prisma.customerAccount.findUnique({ where: { email: input.email }, select: { id: true } });
      if (other && other.id !== req.customer!.id) {
        throw new HttpError(409, 'This email is already used by another account.', { fields: { email: 'Already used by another account' } });
      }
    }
    const account = await prisma.customerAccount.update({
      where: { id: req.customer!.id },
      data: { fullName: input.fullName, email: input.email ?? null },
      include: { identities: true },
    });
    res.json({ ok: true, account: presentAccount(account) });
  }),
);

// POST /api/account/password — change (or, for Google-only accounts, set) the password.
accountRouter.post(
  '/password',
  asyncHandler(async (req, res) => {
    const input = z.object({ currentPassword: z.string().max(200).optional(), newPassword: passwordSchema }).parse(req.body);
    const account = req.customer!;
    if (account.passwordHash) {
      if ((await hit(`account-password:${account.id}`, 15 * 60_000)) > 8) throw new HttpError(429, 'Too many attempts. Please wait 15 minutes.');
      if (!input.currentPassword || !(await bcrypt.compare(input.currentPassword, account.passwordHash))) {
        throw new HttpError(400, 'Your current password is incorrect');
      }
    }
    await prisma.$transaction([
      prisma.customerAccount.update({
        where: { id: account.id },
        data: { passwordHash: await bcrypt.hash(input.newPassword, 12), mustChangePassword: false },
      }),
      // Sign out everywhere else: a password change should cut off anyone else holding a session.
      prisma.customerSession.updateMany({
        where: { accountId: account.id, revokedAt: null, id: { not: req.customerSessionId } },
        data: { revokedAt: new Date() },
      }),
    ]);
    res.json({ ok: true });
  }),
);

// POST /api/account/google — connect a Google account (verified ID token) to this login.
accountRouter.post(
  '/google',
  asyncHandler(async (req, res) => {
    const { idToken } = z.object({ idToken: z.string().min(20).max(5000) }).parse(req.body);
    const profile = await verifyGoogleIdToken(idToken);
    const existing = await prisma.authIdentity.findUnique({ where: { provider_subject: { provider: 'GOOGLE', subject: profile.sub } } });
    if (existing && existing.accountId !== req.customer!.id) {
      throw new HttpError(409, 'That Google account is already connected to a different login.');
    }
    if (!existing) {
      const mine = await prisma.authIdentity.findFirst({ where: { accountId: req.customer!.id, provider: 'GOOGLE' } });
      if (mine) throw new HttpError(409, 'A Google account is already connected. Disconnect it first.');
      await prisma.authIdentity.create({ data: { accountId: req.customer!.id, provider: 'GOOGLE', subject: profile.sub, email: profile.email } });
    }
    res.json({ ok: true, account: presentAccount(await loadAccount(req.customer!.id)) });
  }),
);

accountRouter.delete(
  '/google',
  asyncHandler(async (req, res) => {
    if (!req.customer!.passwordHash) throw new HttpError(409, 'Set a password first, otherwise you would not be able to sign in.');
    await prisma.authIdentity.deleteMany({ where: { accountId: req.customer!.id, provider: 'GOOGLE' } });
    res.json({ ok: true, account: presentAccount(await loadAccount(req.customer!.id)) });
  }),
);

// PUT /api/account/whatsapp — opt in / out of WhatsApp messages.
accountRouter.put(
  '/whatsapp',
  asyncHandler(async (req, res) => {
    const { optIn } = z.object({ optIn: z.boolean() }).parse(req.body);
    const account = req.customer!;
    await recordConsent({
      mobile: account.mobile,
      state: optIn ? 'OPTED_IN' : 'OPTED_OUT',
      source: 'ACCOUNT_SETTINGS',
      consentText: optIn ? WHATSAPP_CONSENT_TEXT : 'Opted out from account settings',
      accountId: account.id,
      studentId: account.studentId,
      ip: clientIp(req),
    });
    res.json({ ok: true, optedIn: optIn });
  }),
);

accountRouter.get(
  '/sessions',
  asyncHandler(async (req, res) => {
    const sessions = await prisma.customerSession.findMany({
      where: { accountId: req.customer!.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true, createdAt: true, lastSeenAt: true, userAgent: true },
    });
    res.json({ ok: true, sessions: sessions.map((s) => ({ ...s, current: s.id === req.customerSessionId })) });
  }),
);

accountRouter.post(
  '/sessions/revoke-others',
  asyncHandler(async (req, res) => {
    const { count } = await prisma.customerSession.updateMany({
      where: { accountId: req.customer!.id, revokedAt: null, id: { not: req.customerSessionId } },
      data: { revokedAt: new Date() },
    });
    res.json({ ok: true, revoked: count });
  }),
);

// GET /api/account/dashboard — enrolments, invoices, payments and online orders.
accountRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const account = req.customer!;
    const orders = await prisma.paymentOrder.findMany({
      where: { accountId: account.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, description: true, amountPaise: true, status: true, createdAt: true, paidAt: true, purpose: true, failureReason: true },
    });
    if (!account.studentId) return res.json({ ok: true, linked: false, enrollments: [], invoices: [], payments: [], orders });

    const todayStr = today();
    const [enrollments, invoices, payments] = await Promise.all([
      prisma.enrollment.findMany({ where: { studentId: account.studentId }, include: enrollInclude, orderBy: { startDate: 'desc' } }),
      prisma.invoice.findMany({
        where: { studentId: account.studentId, status: { not: 'DRAFT' } },
        include: { items: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.payment.findMany({
        where: { invoice: { studentId: account.studentId } },
        include: { receipt: true, invoice: { select: { invoiceNo: true } } },
        orderBy: { paidAt: 'desc' },
      }),
    ]);
    res.json({
      ok: true,
      linked: true,
      enrollments: enrollments.map((e) => {
        const p = presentEnrollment(e, todayStr);
        return {
          id: p.id,
          course: p.coursePlan.course.name,
          plan: p.coursePlan.title,
          timing: p.classTiming?.label ?? null,
          startDate: p.startDate,
          endDate: p.endDate,
          status: p.displayStatus,
          daysRemaining: p.daysRemaining,
        };
      }),
      invoices: invoices.map((i) => ({
        id: i.id,
        invoiceNo: i.invoiceNo,
        createdAt: i.createdAt,
        dueDate: i.dueDate,
        status: i.status,
        totalPaise: i.totalPaise,
        paidPaise: i.amountPaidPaise,
        balancePaise: i.totalPaise - i.amountPaidPaise,
        items: i.items.map((it) => it.description),
      })),
      payments: payments.map((p) => ({
        id: p.id,
        paidAt: p.paidAt,
        amountPaise: p.amountPaise,
        refundedPaise: p.refundedPaise,
        mode: p.mode,
        invoiceNo: p.invoice.invoiceNo,
        receiptId: p.receipt?.id ?? null,
        receiptNo: p.receipt?.receiptNo ?? null,
      })),
      orders,
    });
  }),
);

// PDFs — only for the account's own linked student.
accountRouter.get(
  '/invoices/:id/pdf',
  asyncHandler(async (req, res) => {
    const id = uuid(req.params.id, 'Invoice');
    const invoice = await prisma.invoice.findUnique({ where: { id }, select: { studentId: true } });
    if (!invoice || !req.customer!.studentId || invoice.studentId !== req.customer!.studentId) throw new HttpError(404, 'Invoice not found');
    const { buffer, invoiceNo } = await buildInvoicePdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${invoiceNo.replace(/[^A-Za-z0-9-]/g, '_')}.pdf"`);
    res.send(buffer);
  }),
);

accountRouter.get(
  '/receipts/:id/pdf',
  asyncHandler(async (req, res) => {
    const id = uuid(req.params.id, 'Receipt');
    const receipt = await prisma.receipt.findUnique({ where: { id }, include: { payment: { include: { invoice: { select: { studentId: true } } } } } });
    if (!receipt || !req.customer!.studentId || receipt.payment.invoice.studentId !== req.customer!.studentId) {
      throw new HttpError(404, 'Receipt not found');
    }
    const { buffer, receiptNo } = await buildReceiptPdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${receiptNo.replace(/[^A-Za-z0-9-]/g, '_')}.pdf"`);
    res.send(buffer);
  }),
);

// ───────────────────────── Online payments ─────────────────────────

/** Plans the studio sells online (fee shown). */
accountRouter.get(
  '/plans',
  asyncHandler(async (_req, res) => {
    const plans = await prisma.coursePlan.findMany({
      where: { isActive: true, isOnlinePurchasable: true, course: { isActive: true } },
      include: { course: { select: { id: true, name: true, deliveryMode: true, slug: true } } },
      orderBy: [{ course: { displayOrder: 'asc' } }, { pricePaise: 'asc' }],
    });
    res.json({
      ok: true,
      plans: plans.map((p) => ({ id: p.id, title: p.title, pricePaise: p.pricePaise, durationType: p.durationType, durationValue: p.durationValue, course: p.course })),
    });
  }),
);

const presentOrder = (o: { id: string; gatewayOrderId: string; amountPaise: bigint; currency: string; description: string; status: string; failureReason: string | null; purpose: string; enrollmentId: string | null; paidAt: Date | null }) => ({
  id: o.id,
  gatewayOrderId: o.gatewayOrderId,
  amountPaise: o.amountPaise,
  currency: o.currency,
  description: o.description,
  status: o.status,
  failureReason: o.failureReason,
  purpose: o.purpose,
  enrollmentId: o.enrollmentId,
  paidAt: o.paidAt,
});

// POST /api/account/payments/order — { invoiceId } or { coursePlanId, startDate }. The amount is decided here.
accountRouter.post(
  '/payments/order',
  asyncHandler(async (req, res) => {
    if ((await hit(`checkout:${req.customer!.id}`, 10 * 60_000)) > 20) throw new HttpError(429, 'Too many checkout attempts. Please wait a few minutes.');
    const input = z
      .union([
        z.object({ invoiceId: z.string().uuid() }),
        z.object({ coursePlanId: z.string().uuid(), startDate: z.string() }),
      ])
      .parse(req.body);
    const order =
      'invoiceId' in input
        ? await createInvoiceOrder(req.customer!, input.invoiceId)
        : await createPlanOrder(req.customer!, input.coursePlanId, requireISODate(input.startDate, 'Start date'));
    await markAttempted(order.id);
    res.status(201).json({
      ok: true,
      order: presentOrder(order),
      checkout: { keyId: env.RAZORPAY_KEY_ID, name: req.customer!.fullName, mobile: req.customer!.mobile, email: req.customer!.email },
    });
  }),
);

// POST /api/account/payments/verify — Razorpay Checkout success handler fields.
accountRouter.post(
  '/payments/verify',
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        razorpay_order_id: z.string().min(5).max(100),
        razorpay_payment_id: z.string().min(5).max(100),
        razorpay_signature: z.string().min(10).max(200),
      })
      .parse(req.body);
    const order = await verifyCheckout(req.customer!, input);
    res.json({ ok: true, order: presentOrder(order) });
  }),
);

// GET /api/account/payments/orders/:id — status for the success/failure page (our id or Razorpay's).
accountRouter.get(
  '/payments/orders/:id',
  asyncHandler(async (req, res) => {
    const key = req.params.id;
    const order = await prisma.paymentOrder.findFirst({
      where: { accountId: req.customer!.id, ...(z.string().uuid().safeParse(key).success ? { id: key } : { gatewayOrderId: key }) },
    });
    if (!order) throw new HttpError(404, 'Order not found');
    res.json({ ok: true, order: presentOrder(order) });
  }),
);
