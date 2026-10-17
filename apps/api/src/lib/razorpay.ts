import crypto from 'node:crypto';
import { env } from './env.js';
import { HttpError } from './http.js';

// Minimal Razorpay REST client (Orders, Payments, Refunds) + signature checks.
// Docs: https://razorpay.com/docs/api/  — amounts are in paise.

export function isRazorpayConfigured(): boolean {
  return !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
}

/** "test" for rzp_test_ keys, "live" for rzp_live_ keys. */
export function razorpayMode(): 'test' | 'live' | null {
  if (!env.RAZORPAY_KEY_ID) return null;
  return env.RAZORPAY_KEY_ID.startsWith('rzp_live_') ? 'live' : 'test';
}

export interface RzpOrder {
  id: string;
  amount: number;
  currency: string;
  receipt?: string;
  status: 'created' | 'attempted' | 'paid';
}

export interface RzpPayment {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';
  method?: string;
  fee?: number | null;
  tax?: number | null;
  amount_refunded?: number;
  error_code?: string | null;
  error_description?: string | null;
}

export interface RzpRefund {
  id: string;
  payment_id: string;
  amount: number;
  status: 'pending' | 'processed' | 'failed';
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  if (!isRazorpayConfigured()) throw new HttpError(503, 'Online payments are not set up yet');
  const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
  let resp: Response;
  try {
    resp = await fetch(`${env.RAZORPAY_API_BASE_URL}${path}`, {
      method,
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    console.error('[razorpay] network error', (err as Error).name);
    throw new HttpError(502, 'The payment gateway could not be reached. Please try again.');
  }
  const json = (await resp.json().catch(() => null)) as (T & { error?: { description?: string } }) | null;
  if (!resp.ok || !json) {
    const description = json?.error?.description ?? `HTTP ${resp.status}`;
    console.error(`[razorpay] ${method} ${path.split('?')[0]} failed: ${description}`);
    throw new HttpError(502, `Payment gateway error: ${description}`);
  }
  return json;
}

export const razorpay = {
  createOrder: (args: { amountPaise: bigint; receipt: string; notes: Record<string, string> }) =>
    call<RzpOrder>('POST', '/orders', {
      amount: Number(args.amountPaise),
      currency: 'INR',
      receipt: args.receipt.slice(0, 40),
      notes: args.notes,
    }),
  fetchOrderPayments: (orderId: string) => call<{ items: RzpPayment[] }>('GET', `/orders/${encodeURIComponent(orderId)}/payments`),
  fetchPayment: (paymentId: string) => call<RzpPayment>('GET', `/payments/${encodeURIComponent(paymentId)}`),
  capture: (paymentId: string, amountPaise: number) =>
    call<RzpPayment>('POST', `/payments/${encodeURIComponent(paymentId)}/capture`, { amount: amountPaise, currency: 'INR' }),
  refund: (paymentId: string, amountPaise: bigint, notes: Record<string, string>) =>
    call<RzpRefund>('POST', `/payments/${encodeURIComponent(paymentId)}/refund`, { amount: Number(amountPaise), notes }),
};

function hmacHex(secret: string, data: string | Buffer): string {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

function equalHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Checkout handler signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
  if (!env.RAZORPAY_KEY_SECRET) return false;
  return equalHex(hmacHex(env.RAZORPAY_KEY_SECRET, `${orderId}|${paymentId}`), signature);
}

/** Webhook signature: HMAC_SHA256(raw request body, webhook secret) in X-Razorpay-Signature. */
export function verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!env.RAZORPAY_WEBHOOK_SECRET || !signature) return false;
  return equalHex(hmacHex(env.RAZORPAY_WEBHOOK_SECRET, rawBody), signature);
}
