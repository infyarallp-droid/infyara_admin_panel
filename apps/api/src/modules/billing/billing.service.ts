import type { PaymentSummaryStatus } from '@moksha/shared';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../lib/env.js';
import { HttpError } from '../../lib/http.js';
import { nextCounter, type Tx } from '../../lib/counters.js';
import { businessDate, dateOnly, today } from '../../lib/dates.js';
import { notify } from '../../lib/notify.js';
import { generateInvoicePdf, generateReceiptPdf } from '../../lib/pdf/invoicePdf.js';
import { notifyPaymentReceived } from '../messaging/messaging.service.js';

const rupees = (paise: bigint) => Number(paise) / 100;

/** Convert a rupee amount to paise, rejecting anything that is not a clean money value. */
export function toPaise(amountRupees: number, field = 'Amount'): bigint {
  if (typeof amountRupees !== 'number' || !Number.isFinite(amountRupees)) {
    throw new HttpError(400, `${field} must be a number`);
  }
  const paise = Math.round(amountRupees * 100);
  if (Math.abs(amountRupees * 100 - paise) > 1e-6) {
    throw new HttpError(400, `${field} can have at most 2 decimal places`);
  }
  if (!Number.isSafeInteger(paise)) throw new HttpError(400, `${field} is too large`);
  return BigInt(paise);
}

/** Indian financial year label for a calendar date (YYYY-MM-DD), e.g. 2025-26 (April–March). */
export function financialYear(iso: string = today()): string {
  const y = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const startYear = month >= 4 ? y : y - 1;
  return `${startYear}-${String(startYear + 1).slice(2)}`;
}

/** Next sequential number for a prefix within a financial year (e.g. MW/2025-26/0001). */
async function nextNumber(tx: Tx, kind: 'invoice' | 'receipt'): Promise<string> {
  const prefix = kind === 'invoice' ? `MW/${financialYear()}/` : `MW-RCPT/${financialYear()}/`;
  const n = await nextCounter(tx, prefix, async () => {
    // Continue from the highest number already issued under this prefix.
    const rows =
      kind === 'invoice'
        ? await tx.$queryRaw<{ max: number | null }[]>`
            SELECT MAX(CAST(SUBSTRING("invoice_no" FROM '([0-9]+)$') AS INTEGER)) AS max
            FROM "invoices" WHERE "invoice_no" LIKE ${prefix + '%'}`
        : await tx.$queryRaw<{ max: number | null }[]>`
            SELECT MAX(CAST(SUBSTRING("receipt_no" FROM '([0-9]+)$') AS INTEGER)) AS max
            FROM "receipts" WHERE "receipt_no" LIKE ${prefix + '%'}`;
    return Number(rows[0]?.max ?? 0);
  });
  return `${prefix}${String(n).padStart(4, '0')}`;
}

function totals(subtotalPaise: bigint, discountPaise: bigint) {
  const taxable = subtotalPaise - discountPaise;
  const taxPaise = BigInt(Math.round(Number(taxable) * (env.TAX_PERCENT / 100)));
  const totalPaise = taxable + taxPaise;
  return { taxPaise, totalPaise };
}

export function statusFor(total: bigint, paid: bigint): 'UNPAID' | 'PARTIAL' | 'PAID' {
  if (total <= 0n) return 'PAID'; // complimentary / fully-discounted: nothing is owed
  if (paid <= 0n) return 'UNPAID';
  if (paid >= total) return 'PAID';
  return 'PARTIAL';
}

export interface PaymentSummary {
  invoiceId: string | null;
  invoiceNo: string | null;
  totalPaise: bigint;
  paidPaise: bigint;
  balancePaise: bigint;
  status: PaymentSummaryStatus;
}

/** Fee position of an enrolment across its (non-cancelled) invoices. */
export function summarizePayment(
  invoices: { id: string; invoiceNo: string; totalPaise: bigint; amountPaidPaise: bigint; status: string }[] | undefined,
): PaymentSummary {
  const live = (invoices ?? []).filter((i) => i.status !== 'CANCELLED' && i.status !== 'DRAFT');
  if (!live.length) {
    return { invoiceId: null, invoiceNo: null, totalPaise: 0n, paidPaise: 0n, balancePaise: 0n, status: 'NONE' };
  }
  const totalPaise = live.reduce((s, i) => s + i.totalPaise, 0n);
  const paidPaise = live.reduce((s, i) => s + i.amountPaidPaise, 0n);
  return {
    invoiceId: live[0].id,
    invoiceNo: live[0].invoiceNo,
    totalPaise,
    paidPaise,
    balancePaise: totalPaise - paidPaise,
    status: statusFor(totalPaise, paidPaise),
  };
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
    enrollmentId?: string | null;
    type: 'ENROLLMENT' | 'RENEWAL' | 'PRODUCT' | 'MIXED';
    items: InvoiceItemInput[];
    discountRupees?: number;
    dueDate?: string | null;
    notes?: string | null;
    createdById?: string;
  },
) {
  const items = args.items.map((it) => {
    const unit = toPaise(it.unitPriceRupees, 'Unit price');
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
  const discount = toPaise(args.discountRupees ?? 0, 'Discount');
  if (discount < 0n || discount > subtotal) throw new HttpError(400, 'Discount cannot exceed the invoice subtotal');
  const { taxPaise, totalPaise } = totals(subtotal, discount);
  const invoiceNo = await nextNumber(tx, 'invoice');

  return tx.invoice.create({
    data: {
      invoiceNo,
      studentId: args.studentId ?? null,
      enrollmentId: args.enrollmentId ?? null,
      type: args.type,
      subtotalPaise: subtotal,
      discountPaise: discount,
      taxPaise,
      totalPaise,
      amountPaidPaise: 0n,
      status: statusFor(totalPaise, 0n),
      dueDate: args.dueDate ? dateOnly(args.dueDate.slice(0, 10)) : null,
      notes: args.notes ?? null,
      createdById: args.createdById,
      items: { create: items },
    },
    include: { items: true },
  });
}

/** Create a RENEWAL/ENROLLMENT invoice from an enrollment, linked back to it. */
export async function createInvoiceForEnrollment(
  tx: Tx,
  enrollmentId: string,
  type: 'ENROLLMENT' | 'RENEWAL',
  createdById?: string,
  notes?: string,
) {
  const enr = await tx.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { coursePlan: { include: { course: true } } },
  });
  if (!enr) throw new HttpError(404, 'Enrollment not found');
  const net = rupees(enr.pricePaise - enr.discountPaise);
  return createInvoice(tx, {
    studentId: enr.studentId,
    enrollmentId: enr.id,
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
    notes,
    createdById,
  });
}

export type PaymentModeInput = 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER' | 'OTHER';

export interface RecordPaymentArgs {
  invoiceId: string;
  amountRupees: number;
  mode: PaymentModeInput;
  referenceNo?: string;
  /** Payment date (YYYY-MM-DD); defaults to now. */
  paidOn?: string;
  receivedById?: string;
  /** Client-generated key; the same key always resolves to the same payment. */
  idempotencyKey?: string;
  notes?: string;
  /** Legacy imports record the historical payment without issuing a new receipt number. */
  skipReceipt?: boolean;
}

/**
 * Record a payment inside an existing transaction: lock the invoice, validate
 * against the outstanding balance, write payment + receipt, and recalculate the
 * invoice. Database writes only — no PDF generation or file upload happens
 * here, so nothing external can fail (or time out) the financial transaction.
 */
export async function recordPaymentTx(tx: Tx, args: RecordPaymentArgs) {
  const amount = toPaise(args.amountRupees);
  if (amount <= 0n) throw new HttpError(400, 'Payment amount must be greater than zero');

  // Serialise all payments for this invoice.
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "invoices" WHERE "id" = ${args.invoiceId}::uuid FOR UPDATE`;
  if (!locked.length) throw new HttpError(404, 'Invoice not found');

  if (args.idempotencyKey) {
    const prior = await tx.payment.findUnique({
      where: { idempotencyKey: args.idempotencyKey },
      include: { receipt: true },
    });
    if (prior) {
      if (prior.invoiceId !== args.invoiceId || prior.amountPaise !== amount) {
        throw new HttpError(409, 'This submission key was already used for a different payment');
      }
      const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: args.invoiceId } });
      return { payment: prior, receipt: prior.receipt, invoice, duplicate: true };
    }
  }

  const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: args.invoiceId }, include: { student: true } });
  if (invoice.status === 'CANCELLED') throw new HttpError(409, 'This invoice is cancelled — payments cannot be recorded');
  if (invoice.status === 'DRAFT') throw new HttpError(409, 'This invoice is still a draft — payments cannot be recorded');

  const balance = invoice.totalPaise - invoice.amountPaidPaise;
  if (balance <= 0n) throw new HttpError(409, 'This invoice is already fully paid');
  if (amount > balance) {
    throw new HttpError(
      400,
      `Amount exceeds the outstanding balance of Rs. ${rupees(balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}. Advance/excess payments are not supported.`,
    );
  }

  let paidAt: Date | undefined;
  if (args.paidOn) {
    const iso = args.paidOn.slice(0, 10);
    if (iso > today()) throw new HttpError(400, 'Payment date cannot be in the future');
    // Today's payments keep the real timestamp; back-dated ones are stamped at noon IST.
    paidAt = iso === today() ? undefined : new Date(dateOnly(iso).getTime() + 6.5 * 3_600_000);
  }

  const payment = await tx.payment.create({
    data: {
      invoiceId: invoice.id,
      amountPaise: amount,
      mode: args.mode,
      referenceNo: args.referenceNo?.trim() || null,
      receivedById: args.receivedById,
      idempotencyKey: args.idempotencyKey ?? null,
      notes: args.notes ?? null,
      ...(paidAt ? { paidAt } : {}),
    },
  });

  const newPaid = invoice.amountPaidPaise + amount;
  const updated = await tx.invoice.update({
    where: { id: invoice.id },
    data: { amountPaidPaise: newPaid, status: statusFor(invoice.totalPaise, newPaid) },
    include: { student: true },
  });

  const receipt = args.skipReceipt
    ? null
    : await tx.receipt.create({
        data: { receiptNo: await nextNumber(tx, 'receipt'), paymentId: payment.id, studentId: invoice.studentId },
      });

  return { payment, receipt, invoice: updated, duplicate: false };
}

/** Record a payment, update the invoice and issue a receipt — atomically and idempotently. */
export async function recordPayment(args: RecordPaymentArgs) {
  const result = await prisma.$transaction((tx) => recordPaymentTx(tx, args));

  if (!result.duplicate) {
    // Side effects run only after the money is safely committed, and can never undo it.
    const { invoice, payment } = result;
    const student = 'student' in invoice ? invoice.student : null;
    notify({
      type: 'PAYMENT_RECEIVED',
      title: `Payment received: ${args.amountRupees.toLocaleString('en-IN')}`,
      body: `${student?.fullName ?? 'Walk-in'} · ${invoice.invoiceNo} · ${args.mode}`,
      roleTarget: 'ACCOUNTANT',
      entity: 'invoice',
      entityId: invoice.id,
    }).catch((e) => console.error('[billing] payment notification failed', e));
    if (student) {
      notifyPaymentReceived({
        paymentId: payment.id,
        studentId: student.id,
        studentName: student.fullName,
        mobile: student.mobile,
        amountRupees: rupees(payment.amountPaise),
        invoiceNo: invoice.invoiceNo,
        balanceRupees: rupees(invoice.totalPaise - invoice.amountPaidPaise),
      }).catch((e) => console.error('[billing] payment WhatsApp failed', e));
    }
  }
  return result;
}

/** Generate (and return) an invoice PDF buffer from the current database totals. */
export async function buildInvoicePdf(invoiceId: string): Promise<{ buffer: Buffer; invoiceNo: string }> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { items: true, student: true, payments: { include: { receipt: true }, orderBy: { paidAt: 'asc' } } },
  });
  if (!invoice) throw new HttpError(404, 'Invoice not found');
  const buffer = await generateInvoicePdf({
    invoiceNo: invoice.invoiceNo,
    date: businessDate(invoice.createdAt),
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
    payments: invoice.payments.map((p) => ({
      date: businessDate(p.paidAt),
      mode: p.mode,
      referenceNo: p.referenceNo,
      receiptNo: p.receipt?.receiptNo ?? null,
      amountRupees: rupees(p.amountPaise),
    })),
  });
  return { buffer, invoiceNo: invoice.invoiceNo };
}

/** Generate a receipt PDF on demand, so it never depends on file storage being available. */
export async function buildReceiptPdf(receiptId: string): Promise<{ buffer: Buffer; receiptNo: string }> {
  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    include: { payment: { include: { invoice: { include: { student: true } } } } },
  });
  if (!receipt) throw new HttpError(404, 'Receipt not found');
  const { payment } = receipt;
  const { invoice } = payment;
  const buffer = await generateReceiptPdf({
    receiptNo: receipt.receiptNo,
    date: businessDate(payment.paidAt),
    studentName: invoice.student?.fullName ?? 'Walk-in',
    invoiceNo: invoice.invoiceNo,
    amountRupees: rupees(payment.amountPaise),
    mode: payment.mode,
    referenceNo: payment.referenceNo,
    invoiceTotalRupees: rupees(invoice.totalPaise),
    paidToDateRupees: rupees(invoice.amountPaidPaise),
    balanceRupees: rupees(invoice.totalPaise - invoice.amountPaidPaise),
  });
  return { buffer, receiptNo: receipt.receiptNo };
}
