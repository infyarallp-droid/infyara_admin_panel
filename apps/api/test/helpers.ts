import { TEST_DB } from './setup.js';
import type { AddressInfo } from 'node:net';
import bcrypt from 'bcryptjs';
import { addDaysISO, todayISO } from '@moksha/shared';
import { syncCatalogue } from '../prisma/catalog.js';

// The app reads its environment the moment it is imported, so it must be loaded
// only AFTER ./setup.js has finished pointing everything at the test database.
// A static import would be evaluated alongside setup.js (ES modules do not make
// siblings wait for each other's top-level await), so these are dynamic.
const { app } = await import('../src/app.js');
const { prisma } = await import('../src/lib/prisma.js');
const { env } = await import('../src/lib/env.js');

/** Hard stop unless the live connection really is the dedicated test database. */
async function assertTestDatabase() {
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  if (db !== TEST_DB || !db.endsWith('_test') || !env.DATABASE_URL.includes(`/${TEST_DB}`)) {
    throw new Error(`Refusing to run tests: connected to "${db}", expected the test database "${TEST_DB}"`);
  }
}
await assertTestDatabase();

export { prisma };
export const TODAY = todayISO('Asia/Kolkata');
export const day = (offset: number) => addDaysISO(TODAY, offset);

const server = app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
server.unref();
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

export interface ApiResult<T = any> {
  status: number;
  body: T;
  raw: Buffer;
  headers: Headers;
}

export async function call<T = any>(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; form?: FormData; headers?: Record<string, string> } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  }
  const res = await fetch(BASE + path, { method, headers, body });
  const raw = Buffer.from(await res.arrayBuffer());
  let parsed: unknown = null;
  if ((res.headers.get('content-type') ?? '').includes('json')) parsed = JSON.parse(raw.toString('utf8'));
  return { status: res.status, body: parsed as T, raw, headers: res.headers };
}

const PASSWORD = 'Test@12345';
const tokens = new Map<string, string>();

/** Sign in as a user of the given role (created on first use). */
export async function tokenFor(role: 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'FRONT_DESK' | 'ACCOUNTANT' | 'TRAINER'): Promise<string> {
  const cached = tokens.get(role);
  if (cached) return cached;
  const email = `${role.toLowerCase()}@test.local`;
  await prisma.user.upsert({
    where: { email },
    update: {},
    create: { name: `Test ${role}`, email, role, passwordHash: await bcrypt.hash(PASSWORD, 4) },
  });
  const res = await call('POST', '/api/auth/login', { body: { email, password: PASSWORD } });
  if (res.status !== 200) throw new Error(`login failed for ${role}: ${res.status}`);
  tokens.set(role, res.body.accessToken);
  return res.body.accessToken;
}

const consentSections = {
  healthOptions: [
    { key: 'none_fit', label: 'None of the below / I am currently fit to participate' },
    { key: 'bp', label: 'High/low BP' },
  ],
  clauses: {
    safety: ['Test safety clause — with an em dash and a “smart quote”.'],
    policies: ['Test policy clause.'],
    conduct: ['Test conduct clause.'],
    final: ['Test final clause.'],
  },
};

/** Empty the test database and load the reference data every scenario relies on. */
export async function resetDatabase() {
  await assertTestDatabase(); // checked against the live connection, immediately before truncating
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  tokens.clear();

  await prisma.consentTemplate.create({
    data: { version: 1, title: 'Student Consent, Risk Acknowledgement & Code of Conduct', sections: consentSections, isActive: true },
  });
  const hatha = await prisma.course.create({
    data: {
      name: 'Hatha Yoga',
      code: 'HATHA',
      category: 'REGULAR',
      discipline: 'YOGA',
      plans: {
        create: [
          { title: '1 Month', durationType: 'MONTH_1', durationValue: 30, pricePaise: 250000n },
          { title: '3 Months', durationType: 'MONTH_3', durationValue: 90, pricePaise: 650000n },
        ],
      },
    },
    include: { plans: true },
  });
  await syncCatalogue(prisma);
  const pilates = await prisma.course.findUniqueOrThrow({ where: { code: 'REG-PILATES-ONLINE' } });
  const pilatesPlan = await prisma.coursePlan.create({
    data: { courseId: pilates.id, title: '1 Month', durationType: 'MONTH_1', durationValue: 30, pricePaise: 300000n },
  });
  return {
    hatha,
    hathaMonth: hatha.plans.find((p) => p.title === '1 Month')!,
    hathaQuarter: hatha.plans.find((p) => p.title === '3 Months')!,
    pilates,
    pilatesPlan,
  };
}

let mobileSeq = 9000000100;
/** A fresh synthetic 10-digit mobile (never a real student's number). */
export const nextMobile = () => String(mobileSeq++);

export async function createStudent(token: string, overrides: Record<string, unknown> = {}) {
  const mobile = (overrides.mobile as string) ?? nextMobile();
  const res = await call('POST', '/api/students', {
    token,
    body: { fullName: `Test Student ${mobile.slice(-4)}`, mobile, ...overrides },
  });
  if (res.status !== 201) throw new Error(`createStudent failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.student as { id: string; mobile: string; fullName: string; studentCode: string };
}

export async function enroll(token: string, studentId: string, coursePlanId: string, startDate: string, extra: Record<string, unknown> = {}) {
  return call('POST', '/api/enrollments', { token, body: { studentId, coursePlanId, startDate, ...extra } });
}

/** 1×1 transparent PNG — stands in for a signature-pad image / scanned page. */
export const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
export const SIGNATURE_DATA_URL = `data:image/png;base64,${PNG_1PX.toString('base64')}`;
