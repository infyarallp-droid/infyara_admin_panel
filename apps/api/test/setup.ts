// Test bootstrap — imported FIRST by every integration test file.
//
// • Points the API at a dedicated `<db>_test` database on the local dev Postgres
//   (never the dev or production database) and applies all migrations to it.
// • Replaces the WhatsApp provider with a local mock server, so no real message
//   can ever be sent from a test run.
import { execSync } from 'node:child_process';
import http from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: [resolve(apiDir, '.env'), resolve(apiDir, '../../.env')] });

const base = new URL(process.env.DATABASE_URL ?? '');
if (!['localhost', '127.0.0.1'].includes(base.hostname)) {
  throw new Error(`Refusing to run tests: DATABASE_URL host "${base.hostname}" is not local`);
}
const devDb = base.pathname.replace(/^\//, '');
const testDb = devDb.endsWith('_test') ? devDb : `${devDb}_test`;
const testUrl = new URL(base.toString());
testUrl.pathname = `/${testDb}`;

// Create the test database on first run.
const admin = new PrismaClient({ datasources: { db: { url: base.toString() } } });
const exists = await admin.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM pg_database WHERE datname = '${testDb}'`);
if (!exists.length) await admin.$executeRawUnsafe(`CREATE DATABASE "${testDb}"`);
await admin.$disconnect();

process.env.DATABASE_URL = testUrl.toString();
process.env.NODE_ENV = 'test';
process.env.API_PUBLIC_URL = 'http://localhost:4000';
process.env.STORAGE_PROVIDER ??= 'local';
process.env.RENEWAL_REMINDER_DAYS = '7,3,1';
process.env.ACTIVE_REQUIRES_PAYMENT = 'none';
process.env.RENEWAL_START_DEFAULT = 'TODAY';
process.env.DUPLICATE_ENROLLMENT_OVERRIDE = 'false';
process.env.WHATSAPP_PAYMENT_TEMPLATE = '';
process.env.WHATSAPP_ADMISSION_TEMPLATE = '';

execSync('npx prisma migrate deploy', { cwd: apiDir, env: process.env, stdio: 'pipe' });

// ── Mock WhatsApp Cloud API ──
export interface MockCall {
  to: string;
  template: string;
  params: string[];
  authorization: string | undefined;
}
export const whatsappMock = {
  calls: [] as MockCall[],
  /** Next responses to serve (FIFO); default is a successful send. */
  queue: [] as { status: number; body: unknown }[],
  reset() {
    this.calls.length = 0;
    this.queue.length = 0;
  },
};
let seq = 0;
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    whatsappMock.calls.push({
      to: body.to,
      template: body.template?.name,
      params: (body.template?.components?.[0]?.parameters ?? []).map((p: { text: string }) => p.text),
      authorization: req.headers.authorization,
    });
    const next = whatsappMock.queue.shift() ?? { status: 200, body: { messages: [{ id: `wamid.TEST${++seq}` }] } };
    res.writeHead(next.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(next.body));
  });
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
server.unref();
const mockPort = (server.address() as { port: number }).port;

export const TEST_WHATSAPP_TOKEN = 'test-token-DO-NOT-LOG-7f3a';
if (process.env.TEST_WHATSAPP_UNCONFIGURED === '1') {
  process.env.WHATSAPP_PHONE_NUMBER_ID = '';
  process.env.WHATSAPP_ACCESS_TOKEN = '';
} else {
  process.env.WHATSAPP_PHONE_NUMBER_ID = '100000000000001';
  process.env.WHATSAPP_ACCESS_TOKEN = TEST_WHATSAPP_TOKEN;
}
process.env.WHATSAPP_API_BASE_URL = `http://127.0.0.1:${mockPort}`;
process.env.WHATSAPP_APP_SECRET = '';
process.env.WHATSAPP_REQUIRE_CONSENT = 'true';

// ── Rate limits: a separate Redis database, emptied per run, so earlier runs never leak in ──
{
  const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6399');
  redisUrl.pathname = '/1';
  process.env.REDIS_URL = redisUrl.toString();
  const { default: Redis } = await import('ioredis');
  const r = new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 2000 });
  try {
    await r.connect();
    await r.flushdb();
  } catch {
    /* Redis not running: the limiter falls back to in-process counters */
  } finally {
    r.disconnect();
  }
}

// ── Website ↔ API, jobs ──
export const TEST_SERVICE_KEY = 'test-website-service-key-0123456789';
export const TEST_CRON_SECRET = 'test-cron-secret-0123456789';
process.env.WEBSITE_SERVICE_KEY = TEST_SERVICE_KEY;
process.env.CRON_SECRET = TEST_CRON_SECRET;
process.env.WEBSITE_URL = '';
process.env.WEBSITE_REVALIDATE_SECRET = '';
process.env.TAX_PERCENT = '0';

// ── Mock Google signing keys (JWKS) — test ID tokens are signed with a local key ──
const { generateKeyPair, exportJWK, SignJWT } = await import('jose');
const googleKeys = await generateKeyPair('RS256');
const googleJwk = { ...(await exportJWK(googleKeys.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
export const TEST_GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
const jwksServer = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ keys: [googleJwk] }));
});
await new Promise<void>((r) => jwksServer.listen(0, '127.0.0.1', r));
jwksServer.unref();
process.env.GOOGLE_CLIENT_ID = TEST_GOOGLE_CLIENT_ID;
process.env.GOOGLE_JWKS_URL = `http://127.0.0.1:${(jwksServer.address() as { port: number }).port}/certs`;

/** An ID token as Google would issue it (override fields to test rejection). */
export async function googleIdToken(claims: { sub: string; email?: string; name?: string; aud?: string; iss?: string }) {
  return new SignJWT({ email: claims.email, email_verified: true, name: claims.name })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setSubject(claims.sub)
    .setIssuer(claims.iss ?? 'https://accounts.google.com')
    .setAudience(claims.aud ?? TEST_GOOGLE_CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(googleKeys.privateKey);
}

// ── Mock Razorpay API ──
export const TEST_RZP_KEY_ID = 'rzp_test_mockkey';
export const TEST_RZP_SECRET = 'mock-razorpay-secret';
export const TEST_RZP_WEBHOOK_SECRET = 'mock-razorpay-webhook-secret';
interface MockPayment {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: string;
  method: string;
}
export const razorpayMock = {
  orders: new Map<string, { id: string; amount: number; currency: string; status: string }>(),
  payments: new Map<string, MockPayment>(),
  refunds: [] as { id: string; payment_id: string; amount: number }[],
  /** Status returned for the next refunds ('processed' or 'pending'). */
  refundStatus: 'processed',
  badAuth: 0,
  /** Simulate a customer paying an order (as Razorpay would record it). */
  pay(orderId: string, overrides: Partial<MockPayment> = {}): MockPayment {
    const order = this.orders.get(orderId)!;
    const p: MockPayment = {
      id: `pay_TEST${this.payments.size + 1}${Date.now() % 100000}`,
      order_id: orderId,
      amount: order.amount,
      currency: 'INR',
      status: 'captured',
      method: 'upi',
      ...overrides,
    };
    this.payments.set(p.id, p);
    return p;
  },
};
const rzpServer = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const expected = `Basic ${Buffer.from(`${TEST_RZP_KEY_ID}:${TEST_RZP_SECRET}`).toString('base64')}`;
    if (req.headers.authorization !== expected) {
      razorpayMock.badAuth++;
      return send(401, { error: { description: 'Authentication failed' } });
    }
    const body = raw ? JSON.parse(raw) : {};
    const url = req.url ?? '';
    let m: RegExpMatchArray | null;
    if (req.method === 'POST' && url === '/orders') {
      const order = { id: `order_TEST${razorpayMock.orders.size + 1}${Date.now() % 100000}`, amount: body.amount, currency: body.currency, status: 'created' };
      razorpayMock.orders.set(order.id, order);
      return send(200, order);
    }
    if (req.method === 'GET' && (m = url.match(/^\/orders\/([^/]+)\/payments$/))) {
      return send(200, { items: [...razorpayMock.payments.values()].filter((p) => p.order_id === m![1]) });
    }
    if (req.method === 'GET' && (m = url.match(/^\/payments\/([^/]+)$/))) {
      const p = razorpayMock.payments.get(m[1]);
      return p ? send(200, p) : send(400, { error: { description: 'The id provided does not exist' } });
    }
    if (req.method === 'POST' && (m = url.match(/^\/payments\/([^/]+)\/capture$/))) {
      const p = razorpayMock.payments.get(m[1]);
      if (!p) return send(400, { error: { description: 'not found' } });
      p.status = 'captured';
      return send(200, p);
    }
    if (req.method === 'POST' && (m = url.match(/^\/payments\/([^/]+)\/refund$/))) {
      const refund = { id: `rfnd_TEST${razorpayMock.refunds.length + 1}${Date.now() % 100000}`, payment_id: m[1], amount: body.amount, status: razorpayMock.refundStatus, notes: body.notes };
      razorpayMock.refunds.push(refund);
      return send(200, refund);
    }
    send(404, { error: { description: 'mock: unknown route' } });
  });
});
await new Promise<void>((r) => rzpServer.listen(0, '127.0.0.1', r));
rzpServer.unref();
process.env.RAZORPAY_KEY_ID = TEST_RZP_KEY_ID;
process.env.RAZORPAY_KEY_SECRET = TEST_RZP_SECRET;
process.env.RAZORPAY_WEBHOOK_SECRET = TEST_RZP_WEBHOOK_SECRET;
process.env.RAZORPAY_API_BASE_URL = `http://127.0.0.1:${(rzpServer.address() as { port: number }).port}`;

// ── Mock Anthropic Messages API (streaming) for the website chatbot ──
// A visitor message containing "save my details" makes the mock call save_enquiry with
// claudeMock.toolArgs; after the tool result it answers with text. Anything else gets plain text.
export const claudeMock = {
  requests: [] as { body: any; headers: http.IncomingHttpHeaders }[],
  toolArgs: { name: 'Chat Visitor', mobile: '98765 43210', interest: 'Mat Pilates', preferred_mode: 'Online', note: 'Wants a trial class' } as Record<string, string>,
  /** Status to answer the next request with (e.g. 401 for a bad key). */
  failWith: 0,
  /** Answer the next request with stop_reason "refusal". */
  refuseNext: false,
  reset() {
    this.requests.length = 0;
    this.failWith = 0;
    this.refuseNext = false;
  },
};
const claudeServer = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    claudeMock.requests.push({ body, headers: req.headers });
    if (claudeMock.failWith) {
      const status = claudeMock.failWith;
      claudeMock.failWith = 0;
      res.writeHead(status, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'mock failure' } }));
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const event = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    const finish = (stop_reason: string) => {
      event('message_delta', { delta: { stop_reason, stop_sequence: null }, usage: { output_tokens: 10 } });
      event('message_stop', {});
      res.end();
    };
    event('message_start', {
      message: {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: body.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    });
    const messages = body.messages as { role: string; content: any }[];
    const last = messages[messages.length - 1];
    const toolResult = Array.isArray(last.content) ? last.content.find((b: { type: string }) => b.type === 'tool_result') : null;
    if (claudeMock.refuseNext) {
      claudeMock.refuseNext = false;
      return finish('refusal');
    }
    if (typeof last.content === 'string' && /save my details/i.test(last.content)) {
      const args = JSON.stringify(claudeMock.toolArgs);
      event('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'save_enquiry', input: {} } });
      event('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: args.slice(0, 20) } });
      event('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: args.slice(20) } });
      event('content_block_stop', { index: 0 });
      return finish('tool_use');
    }
    const reply = toolResult ? `Done: ${toolResult.content}` : 'Namaste! Mat Pilates runs online.';
    event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: reply.slice(0, 10) } });
    event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: reply.slice(10) } });
    event('content_block_stop', { index: 0 });
    finish('end_turn');
  });
});
await new Promise<void>((r) => claudeServer.listen(0, '127.0.0.1', r));
claudeServer.unref();
export const TEST_ANTHROPIC_KEY = 'sk-ant-test-DO-NOT-LOG';
process.env.ANTHROPIC_API_KEY = TEST_ANTHROPIC_KEY;
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(claudeServer.address() as { port: number }).port}`;
process.env.CHATBOT_MODEL = 'claude-opus-5-5';
process.env.CHATBOT_VISITOR_DAILY_LIMIT = '40';

export const TEST_DB = testDb;
