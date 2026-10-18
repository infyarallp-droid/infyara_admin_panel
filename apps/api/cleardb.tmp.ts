// One-off: clear test data from a database, keeping staff logins and studio setup.
//   npx tsx cleardb.tmp.ts count   → row counts only (changes nothing)
//   npx tsx cleardb.tmp.ts clear   → TRUNCATE the CLEAR tables in one transaction
// Reads PROD_DATABASE_URL from ../../.env.production. Delete this file afterwards.
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';

const envFile = fs.readFileSync(new URL('../../.env.production', import.meta.url), 'utf8');
const url = /^PROD_DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m.exec(envFile)?.[1];
if (!url) throw new Error('PROD_DATABASE_URL not found in .env.production');

const CLEAR = [
  // People & money
  'students', 'consent_forms', 'consent_uploads', 'enrollments', 'invoices', 'invoice_items', 'payments', 'receipts', 'counters',
  'leads', 'lead_activities', 'zoom_classes',
  // Website accounts & online payments
  'customer_accounts', 'auth_identities', 'customer_sessions', 'customer_login_events', 'payment_orders', 'gateway_payments', 'refunds',
  // Website content & uploads
  'media_assets', 'content_blocks', 'team_members', 'testimonials', 'faqs', 'announcements', 'gallery_items', 'blog_posts',
  // Messaging & logs
  'whatsapp_consents', 'message_campaigns', 'message_logs', 'notifications', 'audit_logs', 'webhook_events', 'job_markers',
];

const prisma = new PrismaClient({ datasources: { db: { url } } });
const mode = process.argv[2];

const [{ db, host }] = await prisma.$queryRaw<{ db: string; host: string }[]>`SELECT current_database() AS db, inet_server_addr()::text AS host`;
console.log(`Connected to database "${db}" on ${host}`);

const tables = (await prisma.$queryRaw<{ t: string }[]>`
  SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename`).map((r) => r.t);
const missing = CLEAR.filter((t) => !tables.includes(t));
const clear = CLEAR.filter((t) => tables.includes(t));
const keep = tables.filter((t) => !CLEAR.includes(t));

const count = async (t: string) => Number((await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) AS n FROM "${t}"`))[0].n);

if (mode === 'count') {
  console.log('\nWILL BE CLEARED:');
  for (const t of clear) console.log(`  ${t.padEnd(24)} ${await count(t)}`);
  console.log('\nKEPT:');
  for (const t of keep) console.log(`  ${t.padEnd(24)} ${await count(t)}`);
  if (missing.length) console.log(`\n(not in this database yet: ${missing.join(', ')})`);
  // Kept tables that point at cleared ones would block (or lose rows to) the clear.
  const fks = await prisma.$queryRaw<{ src: string; dst: string }[]>`
    SELECT DISTINCT c.conrelid::regclass::text AS src, c.confrelid::regclass::text AS dst
    FROM pg_constraint c WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`;
  const blockers = fks.filter((f) => keep.includes(f.src.replace(/"/g, '')) && clear.includes(f.dst.replace(/"/g, '')));
  console.log(blockers.length ? `\nKEPT tables referencing cleared ones: ${blockers.map((b) => `${b.src} → ${b.dst}`).join(', ')}` : '\nNo kept table references a cleared one.');
} else if (mode === 'clear') {
  // No CASCADE: if any kept table still references a cleared one, Postgres refuses and nothing changes.
  await prisma.$executeRawUnsafe(`TRUNCATE ${clear.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY`);
  console.log('Cleared. Remaining rows:');
  for (const t of clear) console.log(`  ${t.padEnd(24)} ${await count(t)}`);
} else {
  console.log('Usage: count | clear');
}
await prisma.$disconnect();
