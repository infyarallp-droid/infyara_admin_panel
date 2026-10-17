import type { CustomerAccount, PaymentOrder } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http.js';
import { notify } from '../../lib/notify.js';
import { addDaysISO, dateOnly, today, toISODate } from '../../lib/dates.js';
import { nextStudentCode } from '../../lib/counters.js';
import { audit } from '../../lib/audit.js';
import { razorpay, verifyCheckoutSignature, type RzpPayment } from '../../lib/razorpay.js';
import { createInvoiceForEnrollment, recordPaymentTx, statusFor, totals, type PaymentModeInput } from '../billing/billing.service.js';
import { findOverlappingEnrollment, lockStudent, overlapMessage, periodEnd } from '../enrollments/enrollments.service.js';
import { notifyAdmission, notifyPaymentReceived } from '../messaging/messaging.service.js';

const rupees = (paise: bigint) => Number(paise) / 100;
const OPEN_ORDER_REUSE_MS = 2 * 60 * 60_000;
const MAX_PLAN_START_DAYS = 90;

function methodToMode(method?: string): PaymentModeInput {
  switch (method) {
    case 'upi':
      return 'UPI';
    case 'card':
      return 'CARD';
    case 'netbanking':
      return 'BANK_TRANSFER';
    default:
      return 'OTHER';
  }
}

// ───────────────────────── Order creation ─────────────────────────

async function reuseOpenOrder(where: Prisma.PaymentOrderWhereInput, amountPaise: bigint) {
  return prisma.paymentOrder.findFirst({
    where: { ...where, status: { in: ['CREATED', 'ATTEMPTED'] }, amountPaise, createdAt: { gte: new Date(Date.now() - OPEN_ORDER_REUSE_MS) } },
    orderBy: { createdAt: 'desc' },
  });
}

/** Pay the outstanding balance of one of the student's own invoices. Amount comes from the database. */
export async function createInvoiceOrder(account: CustomerAccount, invoiceId: string) {
  if (!account.studentId) throw new HttpError(403, 'Your account is not linked to a studio record yet. Please contact the studio.');
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice || invoice.studentId !== account.studentId) throw new HttpError(404, 'Invoice not found');
  if (invoice.status === 'CANCELLED' || invoice.status === 'DRAFT') throw new HttpError(409, 'This invoice cannot be paid online');
  const balance = invoice.totalPaise - invoice.amountPaidPaise;
  if (balance <= 0n) throw new HttpError(409, 'This invoice is already fully paid');

  const open = await reuseOpenOrder({ accountId: account.id, purpose: 'INVOICE', invoiceId }, balance);
  if (open) return open;

  const description = `Invoice ${invoice.invoiceNo}`;
  const rzp = await razorpay.createOrder({
    amountPaise: balance,
    receipt: invoice.invoiceNo,
    notes: { purpose: 'INVOICE', invoiceNo: invoice.invoiceNo, accountId: account.id },
  });
  return prisma.paymentOrder.create({
    data: {
      gatewayOrderId: rzp.id,
      accountId: account.id,
      purpose: 'INVOICE',
      invoiceId,
      amountPaise: balance,
      description,
    },
  });
}

/** Buy a course plan that the studio has marked "available online". */
export async function createPlanOrder(account: CustomerAccount, coursePlanId: string, startDate: string) {
  const plan = await prisma.coursePlan.findUnique({ where: { id: coursePlanId }, include: { course: true } });
  if (!plan || !plan.isActive || !plan.course.isActive || !plan.isOnlinePurchasable) {
    throw new HttpError(404, 'This plan is not available to buy online');
  }
  if (plan.pricePaise <= 0n) throw new HttpError(409, 'This plan has no fee set — please contact the studio');
  const todayStr = today();
  if (startDate < todayStr) throw new HttpError(400, 'The start date cannot be in the past');
  if (startDate > addDaysISO(todayStr, MAX_PLAN_START_DAYS)) {
    throw new HttpError(400, `Choose a start date within the next ${MAX_PLAN_START_DAYS} days`);
  }

  if (account.studentId) {
    const clash = await findOverlappingEnrollment(prisma, {
      studentId: account.studentId,
      courseId: plan.courseId,
      startISO: startDate,
      endISO: periodEnd(startDate, plan),
    });
    if (clash) throw new HttpError(409, `${overlapMessage(clash).replace('Student is', 'You are')}. Please choose a later start date.`);
  } else if (await prisma.student.findUnique({ where: { mobile: account.mobile } })) {
    // A studio record with this number exists but is not linked to this login: staff must confirm it first.
    throw new HttpError(409, 'Your studio record needs to be linked to this account before buying online. Please contact the studio — it only takes a minute.', {
      code: 'LINK_REQUIRED',
    });
  }

  const amount = totals(plan.pricePaise, 0n).totalPaise;
  const open = await reuseOpenOrder({ accountId: account.id, purpose: 'PLAN', coursePlanId, planStartDate: dateOnly(startDate) }, amount);
  if (open) return open;

  const description = `${plan.course.name} — ${plan.title}`;
  const rzp = await razorpay.createOrder({
    amountPaise: amount,
    receipt: `plan-${Date.now()}`,
    notes: { purpose: 'PLAN', plan: description.slice(0, 200), startDate, accountId: account.id },
  });
  return prisma.paymentOrder.create({
    data: {
      gatewayOrderId: rzp.id,
      accountId: account.id,
      purpose: 'PLAN',
      coursePlanId,
      planStartDate: dateOnly(startDate),
      amountPaise: amount,
      description,
    },
  });
}

// ───────────────────────── Applying a captured payment ─────────────────────────

interface ApplyOutcome {
  order: PaymentOrder;
  /** Side effects to run after commit (only when the payment was newly applied). */
  after?: () => Promise<void>;
}

async function upsertGatewayPayment(tx: Prisma.TransactionClient, orderId: string, p: RzpPayment) {
  const data = {
    status: p.status,
    method: p.method ?? null,
    amountPaise: BigInt(p.amount),
    feePaise: p.fee != null ? BigInt(p.fee) : null,
    taxPaise: p.tax != null ? BigInt(p.tax) : null,
    errorCode: p.error_code ?? null,
    errorReason: p.error_description ?? null,
  };
  return tx.gatewayPayment.upsert({
    where: { gatewayPaymentId: p.id },
    create: { orderId, gatewayPaymentId: p.id, ...data },
    update: data,
  });
}

async function needsReview(tx: Prisma.TransactionClient, order: PaymentOrder, reason: string): Promise<ApplyOutcome> {
  const updated = await tx.paymentOrder.update({ where: { id: order.id }, data: { status: 'NEEDS_REVIEW', failureReason: reason, paidAt: new Date() } });
  return {
    order: updated,
    after: async () => {
      await notify({
        type: 'SYSTEM',
        title: 'Online payment needs review',
        body: `${order.description}: ${reason}. The money was received — refund it or apply it manually from Online Payments.`,
        roleTarget: 'ADMIN',
        entity: 'payment_order',
        entityId: order.id,
      });
    },
  };
}

/**
 * Record a captured gateway payment against its order exactly once: payment +
 * receipt on the invoice (or a new enrolment + invoice for a plan purchase).
 * Safe to call any number of times, from the checkout callback, the webhook and
 * the reconciliation job, in any order.
 */
export async function applyCapturedPayment(orderId: string, p: RzpPayment): Promise<PaymentOrder> {
  const result = await prisma.$transaction(
    async (tx): Promise<ApplyOutcome> => {
      // Serialise everything that touches this order.
      await tx.$queryRaw`SELECT "id" FROM "payment_orders" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
      const order = await tx.paymentOrder.findUniqueOrThrow({ where: { id: orderId }, include: { account: true } });
      await upsertGatewayPayment(tx, order.id, p);

      if (order.paymentId || order.status === 'NEEDS_REVIEW') return { order }; // already handled
      if (p.status !== 'captured') return { order };
      if (BigInt(p.amount) !== order.amountPaise || p.currency !== 'INR') {
        return needsReview(tx, order, `amount received (${p.amount} paise ${p.currency}) differs from the order amount (${order.amountPaise} paise)`);
      }

      const common = {
        amountRupees: rupees(order.amountPaise),
        mode: methodToMode(p.method),
        referenceNo: `Razorpay ${p.id}`,
        idempotencyKey: `rzp:${p.id}`,
        notes: `Paid online (${p.method ?? 'Razorpay'})`,
      };

      if (order.purpose === 'INVOICE' && order.invoiceId) {
        await tx.$queryRaw`SELECT "id" FROM "invoices" WHERE "id" = ${order.invoiceId}::uuid FOR UPDATE`;
        const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: order.invoiceId }, include: { student: true } });
        const balance = invoice.totalPaise - invoice.amountPaidPaise;
        if (invoice.status === 'CANCELLED' || invoice.status === 'DRAFT') return needsReview(tx, order, `invoice ${invoice.invoiceNo} is ${invoice.status.toLowerCase()}`);
        if (order.amountPaise > balance) {
          return needsReview(tx, order, `invoice ${invoice.invoiceNo} balance is now ${rupees(balance)} (it was paid another way meanwhile)`);
        }
        const recorded = await recordPaymentTx(tx, { ...common, invoiceId: invoice.id });
        const updated = await tx.paymentOrder.update({
          where: { id: order.id },
          data: { status: 'PAID', paymentId: recorded.payment.id, paidAt: new Date(), failureReason: null },
        });
        return {
          order: updated,
          after: async () => {
            await notify({
              type: 'PAYMENT_RECEIVED',
              title: `Online payment: ₹${common.amountRupees.toLocaleString('en-IN')}`,
              body: `${invoice.student?.fullName ?? order.account.fullName} · ${invoice.invoiceNo} · Razorpay`,
              roleTarget: 'ACCOUNTANT',
              entity: 'invoice',
              entityId: invoice.id,
            });
            if (invoice.student) {
              await notifyPaymentReceived({
                paymentId: recorded.payment.id,
                studentId: invoice.student.id,
                studentName: invoice.student.fullName,
                mobile: invoice.student.mobile,
                amountRupees: common.amountRupees,
                invoiceNo: invoice.invoiceNo,
                balanceRupees: rupees(recorded.invoice.totalPaise - recorded.invoice.amountPaidPaise),
              });
            }
          },
        };
      }

      if (order.purpose === 'PLAN' && order.coursePlanId && order.planStartDate) {
        const plan = await tx.coursePlan.findUniqueOrThrow({ where: { id: order.coursePlanId }, include: { course: true } });
        // Re-read the account under the order lock: it may have been linked since checkout began.
        const account = await tx.customerAccount.findUniqueOrThrow({ where: { id: order.accountId } });
        let studentId = account.studentId;
        if (!studentId) {
          const existing = await tx.student.findUnique({ where: { mobile: account.mobile } });
          if (existing) return needsReview(tx, order, 'a studio record with this mobile exists but is not linked to the website account');
          const created = await tx.student.create({
            data: {
              fullName: account.fullName,
              mobile: account.mobile,
              email: account.email,
              studentCode: await nextStudentCode(tx),
            },
          });
          studentId = created.id;
          await tx.customerAccount.update({ where: { id: account.id }, data: { studentId, linkedAt: new Date() } });
          await audit(tx, { action: 'ACCOUNT_STUDENT_CREATED_ONLINE', entity: 'customer_account', entityId: account.id, meta: { studentId } });
        }
        await lockStudent(tx, studentId);
        const startISO = toISODate(order.planStartDate);
        const endISO = periodEnd(startISO, plan);
        const clash = await findOverlappingEnrollment(tx, { studentId, courseId: plan.courseId, startISO, endISO });
        if (clash) return needsReview(tx, order, overlapMessage(clash));

        const enrollment = await tx.enrollment.create({
          data: {
            studentId,
            coursePlanId: plan.id,
            startDate: dateOnly(startISO),
            endDate: dateOnly(endISO),
            pricePaise: plan.pricePaise,
            discountPaise: 0n,
            notes: 'Bought online via the website',
          },
        });
        const invoice = await createInvoiceForEnrollment(tx, enrollment.id, 'ENROLLMENT', undefined, 'Bought online via the website');
        if (invoice.totalPaise !== order.amountPaise) {
          throw new HttpError(409, 'PLAN_PRICE_CHANGED'); // handled below: rolls back, then flags for review
        }
        const recorded = await recordPaymentTx(tx, { ...common, invoiceId: invoice.id });
        const updated = await tx.paymentOrder.update({
          where: { id: order.id },
          data: { status: 'PAID', paymentId: recorded.payment.id, enrollmentId: enrollment.id, invoiceId: invoice.id, paidAt: new Date(), failureReason: null },
        });
        const student = await tx.student.findUniqueOrThrow({ where: { id: studentId } });
        return {
          order: updated,
          after: async () => {
            await notify({
              type: 'PAYMENT_RECEIVED',
              title: `Online purchase: ${plan.course.name}`,
              body: `${student.fullName} · ${plan.title} from ${startISO} · ₹${common.amountRupees.toLocaleString('en-IN')}`,
              roleTarget: 'ADMIN',
              entity: 'enrollment',
              entityId: enrollment.id,
            });
            await notifyAdmission({
              enrollmentId: enrollment.id,
              studentId: student.id,
              studentName: student.fullName,
              mobile: student.mobile,
              courseLabel: `${plan.course.name} (${plan.title})`,
              startDate: startISO,
            });
            await notifyPaymentReceived({
              paymentId: recorded.payment.id,
              studentId: student.id,
              studentName: student.fullName,
              mobile: student.mobile,
              amountRupees: common.amountRupees,
              invoiceNo: invoice.invoiceNo,
              balanceRupees: 0,
            });
          },
        };
      }
      return needsReview(tx, order, 'order has no invoice or plan to apply the payment to');
    },
    { timeout: 20_000 },
  ).catch(async (err) => {
    if (err instanceof HttpError && err.message === 'PLAN_PRICE_CHANGED') {
      return prisma.$transaction(async (tx) => {
        const order = await tx.paymentOrder.findUniqueOrThrow({ where: { id: orderId } });
        return needsReview(tx, order, 'the plan fee or tax changed after checkout began');
      });
    }
    throw err;
  });

  if (result.after) result.after().catch((e) => console.error('[payments] post-payment notification failed', e));
  return result.order;
}

/** A gateway payment that did not succeed — recorded for the history; the order stays open for a retry. */
export async function recordFailedPayment(orderId: string, p: RzpPayment) {
  await prisma.$transaction(async (tx) => {
    await upsertGatewayPayment(tx, orderId, p);
    await tx.paymentOrder.updateMany({
      where: { id: orderId, status: { in: ['CREATED', 'ATTEMPTED'] } },
      data: { status: 'FAILED', failureReason: p.error_description ?? 'Payment failed' },
    });
  });
}

/** Handle a captured / authorized / failed payment reported by checkout, webhook or reconciliation. */
export async function processGatewayPayment(order: PaymentOrder, p: RzpPayment): Promise<PaymentOrder> {
  if (p.order_id && p.order_id !== order.gatewayOrderId) throw new HttpError(400, 'Payment does not belong to this order');
  let payment = p;
  if (payment.status === 'authorized') {
    // Auto-capture is the recommended dashboard setting; capture here in case it is off.
    payment = await razorpay.capture(payment.id, payment.amount);
  }
  if (payment.status === 'captured') return applyCapturedPayment(order.id, payment);
  if (payment.status === 'failed') await recordFailedPayment(order.id, payment);
  return prisma.paymentOrder.findUniqueOrThrow({ where: { id: order.id } });
}

/** The browser's checkout callback. Its claim is only a hint: the gateway is asked for the truth. */
export async function verifyCheckout(
  account: CustomerAccount,
  input: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string },
) {
  const order = await prisma.paymentOrder.findUnique({ where: { gatewayOrderId: input.razorpay_order_id } });
  if (!order || order.accountId !== account.id) throw new HttpError(404, 'Order not found');
  if (!verifyCheckoutSignature(input.razorpay_order_id, input.razorpay_payment_id, input.razorpay_signature)) {
    throw new HttpError(400, 'Payment signature is invalid');
  }
  const payment = await razorpay.fetchPayment(input.razorpay_payment_id);
  return processGatewayPayment(order, payment);
}

/** Mark an order as being paid (checkout opened). */
export async function markAttempted(orderId: string) {
  await prisma.paymentOrder.updateMany({ where: { id: orderId, status: 'CREATED' }, data: { status: 'ATTEMPTED' } });
}

// ───────────────────────── Reconciliation (job runner) ─────────────────────────

/**
 * Orders left open (browser closed mid-payment, webhook missed): ask the gateway.
 * Captured payments are applied; long-abandoned orders expire.
 */
export async function reconcileOpenOrders(limit = 20) {
  const summary = { checked: 0, paid: 0, expired: 0, errors: 0 };
  const orders = await prisma.paymentOrder.findMany({
    where: {
      status: { in: ['CREATED', 'ATTEMPTED', 'FAILED'] },
      updatedAt: { lte: new Date(Date.now() - 10 * 60_000) },
      createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
    },
    orderBy: { updatedAt: 'asc' },
    take: limit,
  });
  for (const order of orders) {
    summary.checked++;
    try {
      const { items } = await razorpay.fetchOrderPayments(order.gatewayOrderId);
      const done = items.find((p) => p.status === 'captured' || p.status === 'authorized');
      if (done) {
        const after = await processGatewayPayment(order, done);
        if (after.status === 'PAID') summary.paid++;
      } else if (order.createdAt < new Date(Date.now() - 86_400_000)) {
        await prisma.paymentOrder.updateMany({ where: { id: order.id, status: { in: ['CREATED', 'ATTEMPTED', 'FAILED'] } }, data: { status: 'EXPIRED' } });
        summary.expired++;
      } else {
        await prisma.paymentOrder.update({ where: { id: order.id }, data: { updatedAt: new Date() } });
      }
    } catch (err) {
      summary.errors++;
      console.error('[payments] reconcile failed for order', order.id, (err as Error).message);
    }
  }
  return summary;
}

// ───────────────────────── Refunds ─────────────────────────

/** Reflect a processed refund on the gateway payment, the recorded payment and the invoice — exactly once. */
export async function applyRefund(refundId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "refunds" WHERE "id" = ${refundId}::uuid FOR UPDATE`;
    const refund = await tx.refund.findUniqueOrThrow({ where: { id: refundId }, include: { gatewayPayment: { include: { order: true } } } });
    if (refund.appliedAt || refund.status !== 'PROCESSED') return;
    await tx.gatewayPayment.update({ where: { id: refund.gatewayPaymentId }, data: { refundedPaise: { increment: refund.amountPaise } } });
    const paymentId = refund.gatewayPayment.order.paymentId;
    if (paymentId) {
      const payment = await tx.payment.update({ where: { id: paymentId }, data: { refundedPaise: { increment: refund.amountPaise } } });
      await tx.$queryRaw`SELECT "id" FROM "invoices" WHERE "id" = ${payment.invoiceId}::uuid FOR UPDATE`;
      const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: payment.invoiceId } });
      const paid = invoice.amountPaidPaise - refund.amountPaise;
      const newPaid = paid < 0n ? 0n : paid;
      await tx.invoice.update({
        where: { id: invoice.id },
        data: { amountPaidPaise: newPaid, status: invoice.status === 'CANCELLED' ? 'CANCELLED' : statusFor(invoice.totalPaise, newPaid) },
      });
    }
    await tx.refund.update({ where: { id: refund.id }, data: { appliedAt: new Date() } });
    await audit(tx, {
      userId: refund.initiatedById,
      action: 'REFUND_APPLIED',
      entity: 'refund',
      entityId: refund.id,
      meta: { amountPaise: refund.amountPaise.toString(), gatewayRefundId: refund.gatewayRefundId },
    });
  });
}

/** Refund (part of) a captured online payment through Razorpay. */
export async function initiateRefund(args: { gatewayPaymentId: string; amountPaise: bigint; reason: string; userId: string }) {
  const gp = await prisma.gatewayPayment.findUnique({ where: { id: args.gatewayPaymentId }, include: { refunds: true } });
  if (!gp) throw new HttpError(404, 'Payment not found');
  if (gp.status !== 'captured' && gp.status !== 'refunded') throw new HttpError(409, 'Only captured payments can be refunded');
  const committed = gp.refunds.filter((r) => r.status !== 'FAILED').reduce((s, r) => s + r.amountPaise, 0n);
  const refundable = gp.amountPaise - committed;
  if (args.amountPaise <= 0n) throw new HttpError(400, 'Refund amount must be greater than zero');
  if (args.amountPaise > refundable) throw new HttpError(400, `At most ₹${rupees(refundable).toLocaleString('en-IN')} can still be refunded`);

  const refund = await prisma.refund.create({
    data: { gatewayPaymentId: gp.id, amountPaise: args.amountPaise, status: 'PENDING', reason: args.reason, initiatedById: args.userId },
  });
  await prisma.auditLog.create({
    data: { userId: args.userId, action: 'REFUND_INITIATED', entity: 'refund', entityId: refund.id, meta: { amountPaise: args.amountPaise.toString(), reason: args.reason } },
  });
  try {
    const rzp = await razorpay.refund(gp.gatewayPaymentId, args.amountPaise, { reason: args.reason.slice(0, 200), refundRef: refund.id });
    const status = rzp.status === 'processed' ? 'PROCESSED' : rzp.status === 'failed' ? 'FAILED' : 'PENDING';
    await prisma.refund.update({ where: { id: refund.id }, data: { gatewayRefundId: rzp.id, status } });
    if (status === 'PROCESSED') await applyRefund(refund.id);
  } catch (err) {
    await prisma.refund.update({ where: { id: refund.id }, data: { status: 'FAILED' } });
    throw err;
  }
  return prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
}

/** Refund status from the webhook (refund.processed / refund.failed). */
export async function processRefundEvent(r: { id: string; payment_id: string; amount: number; status: string; notes?: Record<string, string> }) {
  let refund = await prisma.refund.findUnique({ where: { gatewayRefundId: r.id } });
  if (!refund && r.notes?.refundRef) {
    refund = await prisma.refund.findUnique({ where: { id: r.notes.refundRef } });
    if (refund) refund = await prisma.refund.update({ where: { id: refund.id }, data: { gatewayRefundId: r.id } });
  }
  if (!refund) {
    // Refund made directly in the Razorpay dashboard: record it so the books stay correct.
    const gp = await prisma.gatewayPayment.findUnique({ where: { gatewayPaymentId: r.payment_id } });
    if (!gp) return;
    refund = await prisma.refund.create({
      data: { gatewayPaymentId: gp.id, gatewayRefundId: r.id, amountPaise: BigInt(r.amount), status: 'PENDING', reason: 'Refunded from the Razorpay dashboard' },
    });
  }
  const status = r.status === 'processed' ? 'PROCESSED' : r.status === 'failed' ? 'FAILED' : 'PENDING';
  if (refund.status !== 'PROCESSED') await prisma.refund.update({ where: { id: refund.id }, data: { status } });
  if (status === 'PROCESSED') await applyRefund(refund.id);
}
