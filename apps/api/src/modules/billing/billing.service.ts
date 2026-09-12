import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../lib/env.js';
import { putObject } from '../../lib/storage.js';
import { notify } from '../../lib/notify.js';
import { generateInvoicePdf, generateReceiptPdf } from '../../lib/pdf/invoicePdf.js';

type Tx = Prisma.TransactionClient | PrismaClient;
const rupees = (paise: bigint) => Number(paise) / 100;

/** Indian financial year label for a date, e.g. 2025-26 (April–March). */
export function financialYear(date = new Date()): string {
  const y = date.getFullYear();
  const startYear = date.getMonth() >= 3 ? y : y - 1; // month 3 = April
  return `${startYear}-${String(startYear + 1).slice(2)}`;
}

/** Next sequential number for a prefix within a financial year (e.g. MW/2025-26/0001). */
async function nextNumber(tx: Tx, kind: 'invoice' | 'receipt'): Promise<string> {
  const fy = financialYear();
  if (kind === 'invoice') {
    const prefix = `MW/${fy}/`;
    const count = await tx.invoice.count({ where: { invoiceNo: { startsWith: prefix } } });
    return `${prefix}${String(count + 1).padStart(4, '0')}`;
  }
  const prefix = `MW-RCPT/${fy}/`;
  const count = await tx.receipt.count({ where: { receiptNo: { startsWith: prefix } } });
  return `${prefix}${String(count + 1).padStart(4, '0')}`;
}

function totals(subtotalPaise: bigint, discountPaise: bigint) {
  const taxable = subtotalPaise - discountPaise;
  const taxPaise = BigInt(Math.round(Number(taxable) * (env.TAX_PERCENT / 100)));
  const totalPaise = taxable + taxPaise;
  return { taxPaise, totalPaise };
}

function statusFor(total: bigint, paid: bigint): 'UNPAID' | 'PARTIAL' | 'PAID' {
  if (paid <= 0n) return 'UNPAID';
  if (paid >= total) return 'PAID';
  return 'PARTIAL';
}

export interface InvoiceItemInput {
  itemType: 'COURSE_PLAN' | 'PRODUCT_VARIANT' | 'CUSTOM';
  refId?: string;
  description: string;
  qty: number;
  unitPriceRupees: number;
}

/** Create an invoice with line items (generic — used by enrollment, renewal, product sales). */
export async function createInvoice(
  tx: Tx,
  args: {
    studentId?: string | null;
    type: 'ENROLLMENT' | 'RENEWAL' | 'PRODUCT' | 'MIXED';
    items: InvoiceItemInput[];
    discountRupees?: number;
    dueDate?: string | null;
    notes?: string | null;
    createdById?: string;
  },
) {
  const items = args.items.map((it) => {
    const unit = BigInt(Math.round(it.unitPriceRupees * 100));
    return {
      itemType: it.itemType,
      refId: it.refId,
      description: it.description,
      qty: it.qty,
      unitPricePaise: unit,
      lineTotalPaise: unit * BigInt(it.qty),
    };
  });
  const subtotal = items.reduce((s, it) => s + it.lineTotalPaise, 0n);
  const discount = BigInt(Math.round((args.discountRupees ?? 0) * 100));
  const { taxPaise, totalPaise } = totals(subtotal, discount);
  const invoiceNo = await nextNumber(tx, 'invoice');

  return tx.invoice.create({
    data: {
      invoiceNo,
      studentId: args.studentId ?? null,
      type: args.type,
      subtotalPaise: subtotal,
      discountPaise: discount,
      taxPaise,
      totalPaise,
      amountPaidPaise: 0n,
      status: 'UNPAID',
      dueDate: args.dueDate ? new Date(args.dueDate) : null,
      notes: args.notes ?? null,
      createdById: args.createdById,
      items: { create: items },
    },
    include: { items: true },
  });
}

/** Create a RENEWAL/ENROLLMENT invoice from an enrollment. */
export async function createInvoiceForEnrollment(
  tx: Tx,
  enrollmentId: string,
  type: 'ENROLLMENT' | 'RENEWAL',
  createdById?: string,
) {
  const enr = await tx.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { coursePlan: { include: { course: true } } },
  });
  if (!enr) throw new Error('Enrollment not found');
  const net = rupees(enr.pricePaise - enr.discountPaise);
  return createInvoice(tx, {
    studentId: enr.studentId,
    type,
    items: [
      {
        itemType: 'COURSE_PLAN',
        refId: enr.coursePlanId,
        description: `${enr.coursePlan.course.name} — ${enr.coursePlan.title}${type === 'RENEWAL' ? ' (Renewal)' : ''}`,
        qty: 1,
        unitPriceRupees: net,
      },
    ],
    createdById,
  });
}

/** Record a payment, update invoice status, and auto-generate a receipt + PDF. */
export async function recordPayment(args: {
  invoiceId: string;
  amountRupees: number;
  mode: 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER' | 'OTHER';
  referenceNo?: string;
  receivedById?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({ where: { id: args.invoiceId }, include: { student: true } });
    if (!invoice) throw new Error('Invoice not found');

    const amount = BigInt(Math.round(args.amountRupees * 100));
    const payment = await tx.payment.create({
      data: {
        invoiceId: invoice.id,
        amountPaise: amount,
        mode: args.mode,
        referenceNo: args.referenceNo,
        receivedById: args.receivedById,
      },
    });

    const newPaid = invoice.amountPaidPaise + amount;
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { amountPaidPaise: newPaid, status: statusFor(invoice.totalPaise, newPaid) },
    });

    const receiptNo = await nextNumber(tx, 'receipt');
    const pdf = await generateReceiptPdf({
      receiptNo,
      date: new Date().toISOString().slice(0, 10),
      studentName: invoice.student?.fullName ?? 'Walk-in',
      invoiceNo: invoice.invoiceNo,
      amountRupees: args.amountRupees,
      mode: args.mode,
      referenceNo: args.referenceNo ?? null,
    });
    const stored = await putObject('receipts', `${receiptNo.replace(/\W+/g, '-')}.pdf`, pdf, 'application/pdf');

    const receipt = await tx.receipt.create({
      data: { receiptNo, paymentId: payment.id, studentId: invoice.studentId, pdfUrl: stored.url },
    });

    await notify({
      type: 'PAYMENT_RECEIVED',
      title: `Payment received: ${args.amountRupees.toLocaleString('en-IN')}`,
      body: `${invoice.student?.fullName ?? 'Walk-in'} · ${invoice.invoiceNo} · ${args.mode}`,
      roleTarget: 'ACCOUNTANT',
      entity: 'invoice',
      entityId: invoice.id,
    });
    return { payment, receipt };
  });
}

/** Generate (and return) an invoice PDF buffer. */
export async function buildInvoicePdf(invoiceId: string): Promise<{ buffer: Buffer; invoiceNo: string }> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { items: true, student: true, payments: true },
  });
  if (!invoice) throw new Error('Invoice not found');
  const buffer = await generateInvoicePdf({
    invoiceNo: invoice.invoiceNo,
    date: invoice.createdAt.toISOString().slice(0, 10),
    studentName: invoice.student?.fullName ?? 'Walk-in',
    studentMobile: invoice.student?.mobile ?? null,
    items: invoice.items.map((i) => ({
      description: i.description,
      qty: i.qty,
      unitRupees: rupees(i.unitPricePaise),
      lineRupees: rupees(i.lineTotalPaise),
    })),
    subtotalRupees: rupees(invoice.subtotalPaise),
    discountRupees: rupees(invoice.discountPaise),
    taxRupees: rupees(invoice.taxPaise),
    totalRupees: rupees(invoice.totalPaise),
    paidRupees: rupees(invoice.amountPaidPaise),
    status: invoice.status,
  });
  return { buffer, invoiceNo: invoice.invoiceNo };
}
