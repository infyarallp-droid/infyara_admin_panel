import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, HttpError } from '../../lib/http.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { buildInvoicePdf, createInvoice, createInvoiceForEnrollment, recordPayment } from './billing.service.js';

export const billingRouter = Router();
billingRouter.use(requireAuth);

const canBill = requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'FRONT_DESK', 'ACCOUNTANT');

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
      where: { id: req.params.id },
      include: { items: true, student: true, payments: { include: { receipt: true }, orderBy: { paidAt: 'desc' } } },
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
    const invoice = await createInvoice(prisma, { ...input, createdById: req.user!.sub });
    res.status(201).json({ ok: true, invoice });
  }),
);

// POST /api/billing/invoices/from-enrollment/:enrollmentId
billingRouter.post(
  '/invoices/from-enrollment/:enrollmentId',
  canBill,
  asyncHandler(async (req, res) => {
    const { type } = z.object({ type: z.enum(['ENROLLMENT', 'RENEWAL']).default('ENROLLMENT') }).parse(req.body);
    const invoice = await createInvoiceForEnrollment(prisma, req.params.enrollmentId, type, req.user!.sub);
    res.status(201).json({ ok: true, invoice });
  }),
);

// POST /api/billing/invoices/:id/payments  → payment + auto receipt
billingRouter.post(
  '/invoices/:id/payments',
  canBill,
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        amountRupees: z.number().positive(),
        mode: z.enum(['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'OTHER']),
        referenceNo: z.string().optional(),
      })
      .parse(req.body);
    const result = await recordPayment({ invoiceId: req.params.id, ...input, receivedById: req.user!.sub });
    res.status(201).json({ ok: true, ...result });
  }),
);

// GET /api/billing/invoices/:id/pdf
billingRouter.get(
  '/invoices/:id/pdf',
  asyncHandler(async (req, res) => {
    const { buffer, invoiceNo } = await buildInvoicePdf(req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${invoiceNo.replace(/\W+/g, '-')}.pdf"`);
    res.send(buffer);
  }),
);
