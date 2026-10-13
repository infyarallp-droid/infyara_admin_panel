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

export const TEST_DB = testDb;
