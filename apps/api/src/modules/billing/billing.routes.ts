import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, HttpError } from '../../lib/http.js';
import { requireISODate } from '../../lib/dates.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import {
  buildInvoicePdf,
  buildReceiptPdf,
  createInvoice,
  createInvoiceForEnrollment,
  recordPayment,
} from './billing.service.js';

export const billingRouter = Router();
billingRouter.use(requireAuth);

const canBill = requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'FRONT_DESK', 'ACCOUNTANT');
const uuid = (value: string, what: string) => {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw new HttpError(400, `Invalid ${what} id`);
  return parsed.data;
};

// GET /api/billing/invoices?studentId=&status=
billingRouter.get(
  '/invoices',
  asyncHandler(async (req, res) => {
    const q = z
      .object({
        studentId: z.string().uuid().optional(),
        status: z.enum(['DRAFT', 'UNPAID', 'PARTIAL', 'PAID', 'CANCELLED']).optional(),
      })
      .parse(req.query);
    const invoices = await prisma.invoice.findMany({
      where: { studentId: q.studentId, status: q.status },
      include: { student: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ ok: true, invoices });
  }),
);

billingRouter.get(
  '/invoices/:id',
  asyncHandler(async (req, res) => {
    const invoice = await prisma.invoice.findUnique({
      where: { id: uuid(req.params.id, 'invoice') },
      include: {
        items: true,
        student: true,
        enrollment: { include: { coursePlan: { include: { course: true } } } },
        payments: { include: { receipt: true }, orderBy: { paidAt: 'desc' } },
      },
    });
    if (!invoice) throw new HttpError(404, 'Invoice not found');
    res.json({ ok: true, invoice });
  }),
);

const itemSchema = z.object({
  itemType: z.enum(['COURSE_PLAN', 'PRODUCT_VARIANT', 'CUSTOM']),
  refId: z.string().uuid().optional(),
  description: z.string().min(1),
  qty: z.number().int().positive(),
  unitPriceRupees: z.number().nonnegative(),
});

// POST /api/billing/invoices  (generic)
billingRouter.post(
  '/invoices',
  canBill,
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        studentId: z.string().uuid().optional(),
        type: z.enum(['ENROLLMENT', 'RENEWAL', 'PRODUCT', 'MIXED']).default('MIXED'),
        items: z.array(itemSchema).min(1),
        discountRupees: z.number().nonnegative().default(0),
        dueDate: z.string().optional(),
        notes: z.string().optional(),
      })
      .parse(req.body);
    const invoice = await prisma.$transaction((tx) => createInvoice(tx, { ...input, createdById: req.user!.sub }));
    res.status(201).json({ ok: true, invoice });
  }),
);

// POST /api/billing/invoices/from-enrollment/:enrollmentId
billingRouter.post(
  '/invoices/from-enrollment/:enrollmentId',
  canBill,
  asyncHandler(async (req, res) => {
    const enrollmentId = uuid(req.params.enrollmentId, 'enrollment');
    const { type } = z.object({ type: z.enum(['ENROLLMENT', 'RENEWAL']).default('ENROLLMENT') }).parse(req.body ?? {});
    const invoice = await prisma.$transaction(async (tx) => {
      // Lock the enrolment so two clicks cannot raise two invoices for the same period.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "enrollments" WHERE "id" = ${enrollmentId}::uuid FOR UPDATE`;
      if (!locked.length) throw new HttpError(404, 'Enrollment not found');
      const existing = await tx.invoice.findFirst({
        where: { enrollmentId, status: { not: 'CANCELLED' } },
        select: { id: true, invoiceNo: true },
      });
      if (existing) {
        throw new HttpError(409, `This enrolment is already billed on invoice ${existing.invoiceNo}`, {
          existingInvoiceId: existing.id,
        });
      }
      return createInvoiceForEnrollment(tx, enrollmentId, type, req.user!.sub);
    });
    res.status(201).json({ ok: true, invoice });
  }),
);

const paymentSchema = z.object({
  amountRupees: z
    .number({ invalid_type_error: 'Amount must be a number', required_error: 'Amount is required' })
    .finite('Amount must be a number')
    .positive('Payment amount must be greater than zero'),
  mode: z.enum(['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'OTHER'], {
    errorMap: () => ({ message: 'Choose a payment mode: CASH, UPI, CARD, BANK_TRANSFER or OTHER' }),
  }),
  referenceNo: z.string().trim().max(100).optional(),
  paidOn: z.string().optional(),
  idempotencyKey: z.string().trim().min(8).max(100).optional(),
});

// POST /api/billing/invoices/:id/payments  → payment + receipt
// Safe to retry: send the same `Idempotency-Key` header (or body.idempotencyKey)
// and the original payment is returned instead of a second one being created.
billingRouter.post(
  '/invoices/:id/payments',
  canBill,
  asyncHandler(async (req, res) => {
    const invoiceId = uuid(req.params.id, 'invoice');
    const input = paymentSchema.parse(req.body);
    const headerKey = req.header('Idempotency-Key')?.trim();
    const idempotencyKey = input.idempotencyKey ?? (headerKey && headerKey.length >= 8 ? headerKey.slice(0, 100) : undefined);
    const paidOn = input.paidOn ? requireISODate(input.paidOn, 'Payment date') : undefined;

    const result = await recordPayment({
      invoiceId,
      amountRupees: input.amountRupees,
      mode: input.mode,
      referenceNo: input.referenceNo,
      paidOn,
      idempotencyKey,
      receivedById: req.user!.sub,
    });
    res.status(result.duplicate ? 200 : 201).json({ ok: true, ...result });
  }),
);

function sendPdf(res: import('express').Response, buffer: Buffer, name: string) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${name.replace(/\W+/g, '-')}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(buffer);
}

// GET /api/billing/invoices/:id/pdf
billingRouter.get(
  '/invoices/:id/pdf',
  asyncHandler(async (req, res) => {
    const { buffer, invoiceNo } = await buildInvoicePdf(uuid(req.params.id, 'invoice'));
    sendPdf(res, buffer, invoiceNo);
  }),
);

// GET /api/billing/receipts/:id/pdf — generated on demand from the recorded payment
billingRouter.get(
  '/receipts/:id/pdf',
  asyncHandler(async (req, res) => {
    const { buffer, receiptNo } = await buildReceiptPdf(uuid(req.params.id, 'receipt'));
    sendPdf(res, buffer, receiptNo);
  }),
);
