// Platform features: website accounts (mobile + password, Google with mandatory mobile),
// Website Logins admin, CMS, WhatsApp consent/campaigns/rules/outbox, Razorpay payments,
// the job runner and the security boundaries around all of them.
// Real Express app + real PostgreSQL; Google keys, Razorpay and WhatsApp are local mocks.
import {
  googleIdToken,
  razorpayMock,
  TEST_CRON_SECRET,
  TEST_RZP_SECRET,
  TEST_RZP_WEBHOOK_SECRET,
  TEST_SERVICE_KEY,
  whatsappMock,
} from './setup.js';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { before, describe, it } from 'node:test';
import { call, createStudent, day, enroll, nextMobile, PNG_1PX, prisma, resetDatabase, TODAY, tokenFor } from './helpers.js';

let ref: Awaited<ReturnType<typeof resetDatabase>>;
let admin: string;
let superAdmin: string;
let frontDesk: string;
let trainer: string;
let accountant: string;

before(async () => {
  ref = await resetDatabase();
  admin = await tokenFor('ADMIN');
  superAdmin = await tokenFor('SUPER_ADMIN');
  frontDesk = await tokenFor('FRONT_DESK');
  trainer = await tokenFor('TRAINER');
  accountant = await tokenFor('ACCOUNTANT');
});

let ipSeq = 1;
/** A call from the website's server (service key + the visitor's forwarded IP). */
function site(method: string, path: string, opts: { body?: unknown; session?: string; ip?: string; key?: string | null } = {}) {
  const headers: Record<string, string> = { 'x-client-ip': opts.ip ?? `10.0.${Math.floor(ipSeq / 250)}.${ipSeq++ % 250}` };
  if (opts.key !== null) headers['x-service-key'] = opts.key ?? TEST_SERVICE_KEY;
  if (opts.session) headers.authorization = `Bearer ${opts.session}`;
  return call(method, path, { body: opts.body, headers });
}

async function signup(overrides: Record<string, unknown> = {}) {
  const mobile = (overrides.mobile as string) ?? nextMobile();
  const res = await site('POST', '/api/customer-auth/signup', {
    body: { fullName: 'Web Student', mobile, password: 'Lotus2024', whatsappOptIn: false, ...overrides },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { mobile, token: res.body.token as string, account: res.body.account };
}

// ───────────────────────── Staff sessions ─────────────────────────

describe('Staff sign-in sessions', () => {
  const email = 'rotate@test.local';
  before(async () => {
    const bcrypt = (await import('bcryptjs')).default;
    await prisma.user.create({ data: { name: 'Rotate', email, passwordHash: await bcrypt.hash('Rotate@123', 10), role: 'MANAGER' } });
  });
  const login = () => call('POST', '/api/auth/login', { body: { email, password: 'Rotate@123' } });

  it('rotates refresh tokens and rejects a used one', async () => {
    const first = await login();
    assert.equal(first.status, 200);
    const r1 = await call('POST', '/api/auth/refresh', { body: { refreshToken: first.body.refreshToken } });
    assert.equal(r1.status, 200);
    assert.notEqual(r1.body.refreshToken, first.body.refreshToken);
    const reuse = await call('POST', '/api/auth/refresh', { body: { refreshToken: first.body.refreshToken } });
    assert.equal(reuse.status, 401, 'a rotated refresh token cannot be used again');
    // Tokens are stored only as hashes.
    assert.equal(await prisma.staffSession.count({ where: { tokenHash: first.body.refreshToken } }), 0);
  });

  it('a deactivated user loses access at the next refresh', async () => {
    const s = await login();
    await prisma.user.update({ where: { email }, data: { isActive: false } });
    const r = await call('POST', '/api/auth/refresh', { body: { refreshToken: s.body.refreshToken } });
    assert.equal(r.status, 401);
    assert.equal((await login()).status, 401);
    await prisma.user.update({ where: { email }, data: { isActive: true } });
  });

  it('logout revokes the refresh token', async () => {
    const s = await login();
    assert.equal((await call('POST', '/api/auth/logout', { body: { refreshToken: s.body.refreshToken } })).status, 200);
    assert.equal((await call('POST', '/api/auth/refresh', { body: { refreshToken: s.body.refreshToken } })).status, 401);
  });

  it('rate-limits repeated wrong passwords for one account', async () => {
    const bad = () => call('POST', '/api/auth/login', { body: { email: 'nobody@test.local', password: 'wrong-pass' } });
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) statuses.push((await bad()).status);
    assert.ok(statuses.slice(0, 8).every((s) => s === 401));
    assert.equal(statuses[9], 429);
  });
});

// ───────────────────────── Website accounts ─────────────────────────

describe('Website sign-up and sign-in (mobile + password)', () => {
  it('only the website server (service key) may call account endpoints', async () => {
    const noKey = await site('POST', '/api/customer-auth/signup', { key: null, body: { fullName: 'X Y', mobile: nextMobile(), password: 'Lotus2024' } });
    assert.equal(noKey.status, 401);
    const wrongKey = await site('POST', '/api/customer-auth/signup', { key: 'guess', body: {} });
    assert.equal(wrongKey.status, 401);
  });

  it('creates an account, signs in, and prevents a second account for the same mobile', async () => {
    const { mobile, token, account } = await signup({ email: 'web@example.com', whatsappOptIn: true });
    assert.equal(account.mobile, mobile);
    assert.equal(account.hasPassword, true);
    assert.equal(account.linkedToStudent, false);
    assert.ok(!JSON.stringify(account).includes('passwordHash'));
    const stored = await prisma.customerAccount.findUniqueOrThrow({ where: { mobile } });
    assert.notEqual(stored.passwordHash, 'Lotus2024');
    assert.equal(await prisma.customerSession.count({ where: { tokenHash: token } }), 0, 'session tokens stored hashed');

    // WhatsApp opt-in recorded with the exact wording.
    const consent = await prisma.whatsAppConsent.findFirstOrThrow({ where: { mobile } });
    assert.equal(consent.state, 'OPTED_IN');
    assert.equal(consent.source, 'WEBSITE_SIGNUP');
    assert.match(consent.consentText ?? '', /WhatsApp/);

    const dup = await site('POST', '/api/customer-auth/signup', { body: { fullName: 'Someone Else', mobile: `+91 ${mobile}`, password: 'Other2024x' } });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.code, 'MOBILE_TAKEN');

    const me = await site('GET', '/api/customer-auth/me', { session: token });
    assert.equal(me.status, 200);
    assert.equal(me.body.account.fullName, 'Web Student');

    const good = await site('POST', '/api/customer-auth/login', { body: { mobile: `0${mobile}`, password: 'Lotus2024' } });
    assert.equal(good.status, 200);
    const bad = await site('POST', '/api/customer-auth/login', { body: { mobile, password: 'wrong' } });
    assert.equal(bad.status, 401);
    const unknown = await site('POST', '/api/customer-auth/login', { body: { mobile: nextMobile(), password: 'whatever1' } });
    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.error, bad.body.error, 'same message whether or not the number exists');

    const logout = await site('POST', '/api/customer-auth/logout', { session: good.body.token });
    assert.equal(logout.status, 200);
    assert.equal((await site('GET', '/api/customer-auth/me', { session: good.body.token })).status, 401);
    assert.equal((await site('GET', '/api/customer-auth/me', { session: token })).status, 200, 'other sessions unaffected');
  });

  it('validates input: weak passwords and invalid mobiles are rejected', async () => {
    const weak = await site('POST', '/api/customer-auth/signup', { body: { fullName: 'Weak Pass', mobile: nextMobile(), password: 'short' } });
    assert.equal(weak.status, 400);
    const badMobile = await site('POST', '/api/customer-auth/signup', { body: { fullName: 'Bad Mobile', mobile: '12345', password: 'Lotus2024' } });
    assert.equal(badMobile.status, 400);
    const landline = await site('POST', '/api/customer-auth/signup', { body: { fullName: 'Bad Mobile', mobile: '1234567890', password: 'Lotus2024' } });
    assert.equal(landline.status, 400);
  });

  it('locks a mobile number after repeated wrong passwords, and records every attempt', async () => {
    const { mobile } = await signup();
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) {
      statuses.push((await site('POST', '/api/customer-auth/login', { body: { mobile, password: 'nope-nope1' } })).status);
    }
    assert.equal(statuses[9], 429);
    const right = await site('POST', '/api/customer-auth/login', { body: { mobile, password: 'Lotus2024' } });
    assert.equal(right.status, 429, 'even the right password waits out the lock');
    assert.ok((await prisma.customerLoginEvent.count({ where: { mobile, success: false } })) >= 8);
  });

  it('a suspended account cannot sign in and its sessions end', async () => {
    const { mobile, token, account } = await signup();
    const s = await call('POST', `/api/website-logins/${account.id}/status`, { token: admin, body: { status: 'SUSPENDED', reason: 'test' } });
    assert.equal(s.status, 200);
    assert.equal((await site('GET', '/api/customer-auth/me', { session: token })).status, 401);
    assert.equal((await site('POST', '/api/customer-auth/login', { body: { mobile, password: 'Lotus2024' } })).status, 403);
  });
});

describe('Continue with Google (mobile number is mandatory)', () => {
  it('creates no account until a mobile number is added, then signs straight in next time', async () => {
    const idToken = await googleIdToken({ sub: 'google-sub-1', email: 'g1@gmail.com', name: 'Gita Google' });
    const first = await site('POST', '/api/customer-auth/google', { body: { idToken } });
    assert.equal(first.status, 200);
    assert.equal(first.body.status, 'NEEDS_MOBILE');
    assert.equal(first.body.profile.email, 'g1@gmail.com');
    assert.equal(await prisma.authIdentity.count({ where: { subject: 'google-sub-1' } }), 0, 'no account without a mobile');
    assert.ok(!first.body.token, 'no session before the mobile step');

    const mobile = nextMobile();
    const done = await site('POST', '/api/customer-auth/google/complete', {
      body: { pendingToken: first.body.pendingToken, fullName: 'Gita Google', mobile, whatsappOptIn: false },
    });
    assert.equal(done.status, 201);
    assert.equal(done.body.account.mobile, mobile);
    assert.equal(done.body.account.signupMethod, 'GOOGLE');
    assert.equal(done.body.account.hasPassword, false);

    const again = await site('POST', '/api/customer-auth/google', { body: { idToken: await googleIdToken({ sub: 'google-sub-1', email: 'g1@gmail.com' }) } });
    assert.equal(again.body.status, 'SIGNED_IN');
    assert.ok(again.body.token);

    // Replaying the pending ticket cannot create a second account.
    const replay = await site('POST', '/api/customer-auth/google/complete', {
      body: { pendingToken: first.body.pendingToken, fullName: 'Gita Google', mobile: nextMobile() },
    });
    assert.equal(replay.status, 409);

    // Mobile+password login is refused with a pointer to Google (no password set).
    const pw = await site('POST', '/api/customer-auth/login', { body: { mobile, password: 'Lotus2024' } });
    assert.equal(pw.status, 401);
    assert.equal(pw.body.code, 'USE_GOOGLE');
  });

  it('never merges into an existing account by an unverified mobile number', async () => {
    const existing = await signup();
    const first = await site('POST', '/api/customer-auth/google', { body: { idToken: await googleIdToken({ sub: 'google-sub-2', email: 'g2@gmail.com' }) } });
    const clash = await site('POST', '/api/customer-auth/google/complete', {
      body: { pendingToken: first.body.pendingToken, fullName: 'Intruder', mobile: existing.mobile },
    });
    assert.equal(clash.status, 409);
    assert.equal(clash.body.code, 'MOBILE_TAKEN');
    assert.equal(await prisma.authIdentity.count({ where: { subject: 'google-sub-2' } }), 0);

    // The real owner can connect Google from inside their signed-in account.
    const link = await site('POST', '/api/account/google', { session: existing.token, body: { idToken: await googleIdToken({ sub: 'google-sub-2', email: 'g2@gmail.com' }) } });
    assert.equal(link.status, 200);
    assert.equal(link.body.account.google, 'g2@gmail.com');
    const viaGoogle = await site('POST', '/api/customer-auth/google', { body: { idToken: await googleIdToken({ sub: 'google-sub-2' }) } });
    assert.equal(viaGoogle.body.status, 'SIGNED_IN');
    assert.equal(viaGoogle.body.account.id, existing.account.id);
  });

  it('rejects forged or foreign ID tokens and tampered pending tickets', async () => {
    const wrongAud = await site('POST', '/api/customer-auth/google', { body: { idToken: await googleIdToken({ sub: 'x', aud: 'someone-else' }) } });
    assert.equal(wrongAud.status, 401);
    const wrongIss = await site('POST', '/api/customer-auth/google', { body: { idToken: await googleIdToken({ sub: 'x', iss: 'https://evil.example' }) } });
    assert.equal(wrongIss.status, 401);
    const tampered = await site('POST', '/api/customer-auth/google/complete', {
      body: { pendingToken: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.invalidsignatureinvalid', fullName: 'Nope Nope', mobile: nextMobile() },
    });
    assert.equal(tampered.status, 401);
  });
});

// ───────────────────────── Website Logins admin + account linking ─────────────────────────

describe('Website Logins page (admin)', () => {
  it('lists every website account with sign-in history and a suggested student match', async () => {
    const student = await createStudent(admin, { fullName: 'Studio Student' });
    const web = await signup({ mobile: student.mobile, fullName: 'Studio Student Web' });
    await site('POST', '/api/customer-auth/login', { body: { mobile: student.mobile, password: 'Lotus2024' } });

    const list = await call('GET', `/api/website-logins?q=${student.mobile}`, { token: frontDesk });
    assert.equal(list.status, 200);
    const row = list.body.accounts.find((a: any) => a.id === web.account.id);
    assert.ok(row, 'the website login appears on the page');
    assert.equal(row.loginCount, 2);
    assert.ok(row.lastLoginAt);
    assert.equal(row.studentId, null, 'never linked automatically');
    assert.equal(row.suggestedStudent.id, student.id);
    assert.ok(!('passwordHash' in row));
    assert.ok(list.body.stats.accounts >= 1);

    const detail = await call('GET', `/api/website-logins/${web.account.id}`, { token: admin });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.events.filter((e: any) => e.success).length, 2);
    assert.equal(detail.body.sessions.length, 2);

    const activity = await call('GET', '/api/website-logins/activity?limit=5', { token: admin });
    assert.equal(activity.status, 200);
    assert.ok(activity.body.events.length > 0);
  });

  it('links an account to a student (staff only) and shows the student their own records only', async () => {
    const student = await createStudent(admin, { fullName: 'Linked Learner' });
    const enr = await enroll(admin, student.id, ref.hathaMonth.id, TODAY);
    assert.equal(enr.status, 201);
    const web = await signup({ mobile: student.mobile });

    const before = await site('GET', '/api/account/dashboard', { session: web.token });
    assert.equal(before.body.linked, false);
    assert.equal(before.body.invoices.length, 0, 'nothing visible before staff confirm the link');

    assert.equal((await call('POST', `/api/website-logins/${web.account.id}/link`, { token: frontDesk, body: { studentId: student.id } })).status, 403);
    const link = await call('POST', `/api/website-logins/${web.account.id}/link`, { token: admin, body: { studentId: student.id } });
    assert.equal(link.status, 200);
    assert.equal(await prisma.auditLog.count({ where: { action: 'ACCOUNT_LINKED', entityId: web.account.id } }), 1);

    const after = await site('GET', '/api/account/dashboard', { session: web.token });
    assert.equal(after.body.linked, true);
    assert.equal(after.body.enrollments.length, 1);
    assert.equal(after.body.invoices.length, 1);
    const invoiceId = after.body.invoices[0].id;
    const pdf = await site('GET', `/api/account/invoices/${invoiceId}/pdf`, { session: web.token });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.raw.subarray(0, 5).toString(), '%PDF-');

    // Another account cannot read it.
    const other = await signup();
    assert.equal((await site('GET', `/api/account/invoices/${invoiceId}/pdf`, { session: other.token })).status, 404);

    // A second login cannot claim the same student.
    const dup = await call('POST', `/api/website-logins/${other.account.id}/link`, { token: admin, body: { studentId: student.id } });
    assert.equal(dup.status, 409);
  });

  it('staff can issue a temporary password that must be changed', async () => {
    const web = await signup();
    const reset = await call('POST', `/api/website-logins/${web.account.id}/reset-password`, { token: admin });
    assert.equal(reset.status, 200);
    const temp = reset.body.temporaryPassword as string;
    assert.equal((await site('GET', '/api/customer-auth/me', { session: web.token })).status, 401, 'old sessions ended');
    const login = await site('POST', '/api/customer-auth/login', { body: { mobile: web.mobile, password: temp } });
    assert.equal(login.status, 200);
    assert.equal(login.body.account.mustChangePassword, true);
    const change = await site('POST', '/api/account/password', { session: login.body.token, body: { currentPassword: temp, newPassword: 'NewLotus2025' } });
    assert.equal(change.status, 200);
    const me = await site('GET', '/api/customer-auth/me', { session: login.body.token });
    assert.equal(me.body.account.mustChangePassword, false);
  });
});

describe('Admin access control', () => {
  it('every admin module refuses anonymous callers and roles without permission', async () => {
    const adminOnly = ['/api/cms/blocks', '/api/whatsapp/status', '/api/payments/orders', '/api/system/audit', '/api/website-logins'];
    for (const path of adminOnly) {
      assert.equal((await call('GET', path)).status, 401, `${path} anonymous`);
      assert.equal((await call('GET', path, { token: trainer })).status, 403, `${path} trainer`);
    }
    assert.equal((await call('GET', '/api/system/audit', { token: accountant })).status, 403);
    assert.equal((await call('GET', '/api/payments/orders', { token: accountant })).status, 200);
    // Customer sessions are not staff tokens and vice versa.
    const web = await signup();
    assert.equal((await call('GET', '/api/cms/blocks', { token: web.token })).status, 401);
    assert.equal((await site('GET', '/api/account', { session: admin })).status, 401);
  });
});

// ───────────────────────── CMS ─────────────────────────

describe('Website content management', () => {
  it('drafts are private until published; the public endpoint serves only published content', async () => {
    const get = await call('GET', '/api/cms/blocks/home.hero', { token: admin });
    assert.equal(get.status, 200);
    assert.equal(get.body.draft.title, 'Come home to', 'editor starts from the current website copy');

    const draft = { ...get.body.draft, title: 'Breathe with us' };
    assert.equal((await call('PUT', '/api/cms/blocks/home.hero', { token: admin, body: { data: draft } })).status, 200);
    let pub = await call('GET', '/api/public/site');
    assert.equal(pub.body.blocks['home.hero'], null, 'nothing published yet');

    // Preview needs the website's service key.
    assert.equal((await call('GET', '/api/public/site?preview=1')).status, 401);
    const preview = await call('GET', '/api/public/site?preview=1', { headers: { 'x-service-key': TEST_SERVICE_KEY } });
    assert.equal(preview.body.blocks['home.hero'].title, 'Breathe with us');

    assert.equal((await call('POST', '/api/cms/blocks/home.hero/publish', { token: admin })).status, 200);
    pub = await call('GET', '/api/public/site');
    assert.equal(pub.body.blocks['home.hero'].title, 'Breathe with us');
  });

  it('rejects unsafe links, unknown sections and over-long text', async () => {
    const xss = await call('PUT', '/api/cms/blocks/home.hero', { token: admin, body: { data: { title: 'Hi', primaryCtaHref: 'javascript:alert(1)' } } });
    assert.equal(xss.status, 400);
    assert.equal((await call('PUT', '/api/cms/blocks/nope', { token: admin, body: { data: {} } })).status, 404);
    const long = await call('PUT', '/api/cms/blocks/home.cta', { token: admin, body: { data: { title: 'x'.repeat(200) } } });
    assert.equal(long.status, 400);
    assert.equal((await call('PUT', '/api/cms/blocks/home.hero', { token: frontDesk, body: { data: { title: 'x' } } })).status, 403);
  });

  it('team members: create, publish, reorder and archive', async () => {
    const a = await call('POST', '/api/cms/team', { token: admin, body: { name: 'Asha Rao', title: 'Lead Yoga Teacher', shortBio: 'Twelve years of Hatha practice.', status: 'PUBLISHED' } });
    assert.equal(a.status, 201);
    assert.equal(a.body.item.slug, 'asha-rao');
    const b = await call('POST', '/api/cms/team', { token: admin, body: { name: 'Asha Rao', title: 'Pilates', shortBio: 'Mat Pilates instructor.', status: 'DRAFT' } });
    assert.equal(b.body.item.slug, 'asha-rao-2', 'slugs stay unique');

    let pub = await call('GET', '/api/public/site');
    assert.deepEqual(pub.body.team.map((t: any) => t.name), ['Asha Rao']);
    assert.ok(!('employeeId' in pub.body.team[0]), 'no HR link exposed');

    await call('PATCH', `/api/cms/team/${b.body.item.id}/status`, { token: admin, body: { status: 'PUBLISHED' } });
    await call('POST', '/api/cms/team/reorder', { token: admin, body: { ids: [b.body.item.id, a.body.item.id] } });
    pub = await call('GET', '/api/public/site');
    assert.deepEqual(pub.body.team.map((t: any) => t.title), ['Pilates', 'Lead Yoga Teacher']);

    await call('PATCH', `/api/cms/team/${a.body.item.id}/status`, { token: admin, body: { status: 'ARCHIVED' } });
    pub = await call('GET', '/api/public/site');
    assert.equal(pub.body.team.length, 1);
  });

  it('testimonials need recorded consent to be published, and only consented media is public', async () => {
    const body = {
      studentName: 'Meera K',
      quote: 'My back pain has eased and I sleep better.',
      videoSource: 'YOUTUBE',
      videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      photoUrl: 'http://localhost:4000/uploads/public/images/meera.jpg',
      status: 'PUBLISHED',
    };
    const noConsent = await call('POST', '/api/cms/testimonials', { token: admin, body });
    assert.equal(noConsent.status, 409);
    assert.match(noConsent.body.error, /consent/i);

    const badVideo = await call('POST', '/api/cms/testimonials', { token: admin, body: { ...body, videoUrl: 'https://example.com/v', consentName: true, consentVideo: true, consentPhoto: true } });
    assert.equal(badVideo.status, 400);

    const ok = await call('POST', '/api/cms/testimonials', { token: admin, body: { ...body, consentName: true, consentVideo: true, consentPhoto: true } });
    assert.equal(ok.status, 201);
    assert.ok(ok.body.item.consentRecordedAt);

    // Withdraw photo consent: the photo disappears from the public payload.
    const upd = await call('PUT', `/api/cms/testimonials/${ok.body.item.id}`, { token: admin, body: { ...body, photoUrl: null, consentName: true, consentVideo: true, consentPhoto: false } });
    assert.equal(upd.status, 200);
    const pub = await call('GET', '/api/public/site');
    const t = pub.body.testimonials.find((x: any) => x.id === ok.body.item.id);
    assert.equal(t.photoUrl, null);
    assert.equal(t.videoSource, 'YOUTUBE');
  });

  it('media uploads accept real images and reject disguised files', async () => {
    const png = new FormData();
    png.append('file', new Blob([PNG_1PX], { type: 'image/png' }), 'photo.png');
    const up = await call('POST', '/api/cms/media', { token: admin, form: png });
    assert.equal(up.status, 201);
    assert.equal(up.body.asset.kind, 'IMAGE');
    assert.equal(up.body.asset.mimeType, 'image/png');

    const svg = new FormData();
    svg.append('file', new Blob(['<svg onload="alert(1)"></svg>'], { type: 'image/png' }), 'evil.png');
    assert.equal((await call('POST', '/api/cms/media', { token: admin, form: svg })).status, 400);

    // A file in use cannot be deleted.
    await call('POST', '/api/cms/gallery', { token: admin, body: { url: up.body.asset.url, caption: 'Studio' } });
    assert.equal((await call('DELETE', `/api/cms/media/${up.body.asset.id}`, { token: admin })).status, 409);
  });

  it('FAQs and time-boxed announcements appear only when published and current', async () => {
    await call('POST', '/api/cms/faqs', { token: admin, body: { question: 'Do you have parking?', answer: 'Yes, in front of the studio.', status: 'PUBLISHED' } });
    await call('POST', '/api/cms/announcements', {
      token: admin,
      body: { message: 'Diwali batch opens!', status: 'PUBLISHED', endsAt: new Date(Date.now() - 1000).toISOString() },
    });
    await call('POST', '/api/cms/announcements', { token: admin, body: { message: 'New evening Pilates batch', status: 'PUBLISHED', linkUrl: '/classes', linkLabel: 'See classes' } });
    const pub = await call('GET', '/api/public/site');
    assert.ok(pub.body.faqs.some((f: any) => f.question === 'Do you have parking?'));
    assert.deepEqual(pub.body.announcements.map((a: any) => a.message), ['New evening Pilates batch']);
  });

  it('programmes come from the course catalogue; plans can be sold online', async () => {
    const put = await call('PUT', `/api/cms/programmes/${ref.hatha.id}`, {
      token: admin,
      body: { slug: 'hatha-yoga', isPublished: true, publicSummary: 'Classic Hatha.', publicForWhom: 'Everyone', displayOrder: 1 },
    });
    assert.equal(put.status, 200);
    assert.equal((await call('PUT', `/api/cms/plans/${ref.hathaMonth.id}/online`, { token: frontDesk, body: { isOnlinePurchasable: true } })).status, 403);
    assert.equal((await call('PUT', `/api/cms/plans/${ref.hathaMonth.id}/online`, { token: admin, body: { isOnlinePurchasable: true } })).status, 200);
    const pub = await call('GET', '/api/public/site');
    const hatha = pub.body.programmes.find((p: any) => p.slug === 'hatha-yoga');
    assert.equal(hatha.onlinePlans.length, 1);
    assert.equal(hatha.onlinePlans[0].pricePaise, '250000');
  });
});

// ───────────────────────── WhatsApp ─────────────────────────

describe('WhatsApp consent, campaigns, rules and the outbox', () => {
  let templateId: string;
  const tick = () => call('POST', '/internal/jobs/tick', { headers: { 'x-cron-secret': TEST_CRON_SECRET } });
  const callsTo = (mobile: string) => whatsappMock.calls.filter((c) => c.to === `91${mobile}`);

  before(async () => {
    const t = await call('POST', '/api/whatsapp/templates', {
      token: admin,
      body: { name: 'class_update', language: 'en', category: 'UTILITY', bodyText: 'Hi {{1}}, {{2}}' },
    });
    assert.equal(t.status, 201);
    assert.equal(t.body.template.variableCount, 2);
    templateId = t.body.template.id;
  });

  it('the job runner needs its secret', async () => {
    assert.equal((await call('POST', '/internal/jobs/tick')).status, 401);
    assert.equal((await call('POST', '/internal/jobs/tick', { headers: { 'x-cron-secret': 'wrong' } })).status, 401);
    assert.equal((await tick()).status, 200);
  });

  it('a campaign messages opted-in students only, with personalised values', async () => {
    whatsappMock.reset();
    const yes = await createStudent(admin, { fullName: 'Opted In' });
    const no = await createStudent(admin, { fullName: 'Not Asked', whatsappConsent: false });
    const res = await call('POST', '/api/whatsapp/campaigns', {
      token: admin,
      body: { name: 'Holiday notice', templateId, params: ['{first_name}', 'the studio is closed on Friday'], studentIds: [yes.id, no.id] },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.queued, 1);
    assert.equal(res.body.skipped, 1);
    assert.equal(callsTo(yes.mobile).length, 1);
    assert.deepEqual(callsTo(yes.mobile)[0].params, ['Opted', 'the studio is closed on Friday']);
    assert.equal(callsTo(no.mobile).length, 0, 'never messaged without consent');
    const skipped = await prisma.messageLog.findFirstOrThrow({ where: { studentId: no.id } });
    assert.equal(skipped.status, 'NO_CONSENT');

    // Wrong number of values for the template is refused.
    const wrong = await call('POST', '/api/whatsapp/campaigns', { token: admin, body: { name: 'x', templateId, params: ['only one'], studentIds: [yes.id] } });
    assert.equal(wrong.status, 400);
  });

  it('a scheduled campaign waits until its time, can be cancelled, and is never sent twice', async () => {
    whatsappMock.reset();
    const s = await createStudent(admin);
    const later = new Date(Date.now() + 3_600_000).toISOString();
    const res = await call('POST', '/api/whatsapp/campaigns', { token: admin, body: { name: 'Later', templateId, params: ['{name}', 'see you'], studentIds: [s.id], scheduledAt: later } });
    assert.equal(res.status, 201);
    await tick();
    assert.equal(callsTo(s.mobile).length, 0, 'not before its time');

    // Time passes…
    await prisma.messageLog.updateMany({ where: { campaignId: res.body.campaign.id }, data: { scheduledFor: new Date(Date.now() - 1000) } });
    await tick();
    await tick();
    assert.equal(callsTo(s.mobile).length, 1, 'sent exactly once');

    const s2 = await createStudent(admin);
    const c2 = await call('POST', '/api/whatsapp/campaigns', { token: admin, body: { name: 'Cancel me', templateId, params: ['{name}', 'x'], studentIds: [s2.id], scheduledAt: later } });
    assert.equal((await call('POST', `/api/whatsapp/campaigns/${c2.body.campaign.id}/cancel`, { token: admin })).body.cancelled, 1);
    await prisma.messageLog.updateMany({ where: { campaignId: c2.body.campaign.id }, data: { scheduledFor: new Date(Date.now() - 1000) } });
    await tick();
    assert.equal(callsTo(s2.mobile).length, 0);
  });

  it('a renewal rule queues one reminder per enrolment period and replaces the built-in reminder', async () => {
    const rule = await call('POST', '/api/whatsapp/rules', {
      token: admin,
      body: { name: 'Renewal in 5 days', trigger: 'ENROLLMENT_EXPIRY', offsetDays: 5, templateId, params: ['{name}', 'your {course} ends on {end_date}'], isEnabled: true },
    });
    assert.equal(rule.status, 201);
    whatsappMock.reset();
    const s = await createStudent(admin, { fullName: 'Rule Target' });
    await enroll(admin, s.id, ref.hathaMonth.id, day(-27)); // ends in 3 days
    await tick();
    await tick();
    const sent = callsTo(s.mobile);
    assert.equal(sent.length, 1, 'one reminder, not one per tick, and no extra built-in reminder');
    assert.equal(sent[0].template, 'class_update');
    assert.deepEqual(sent[0].params, ['Rule Target', `your Hatha Yoga (1 Month) ends on ${day(3)}`]);

    await call('PATCH', `/api/whatsapp/rules/${rule.body.rule.id}/enabled`, { token: admin, body: { isEnabled: false } });
  });

  it('a "STOP" reply opts the student out; later messages are skipped', async () => {
    whatsappMock.reset();
    const s = await createStudent(admin);
    const inbound = await call('POST', '/webhooks/whatsapp', {
      body: { entry: [{ changes: [{ value: { messages: [{ from: `91${s.mobile}`, id: 'wamid.in1', type: 'text', text: { body: 'STOP' } }] } }] }] },
    });
    assert.equal(inbound.status, 200);
    for (let i = 0; i < 40 && !(await prisma.whatsAppConsent.findFirst({ where: { mobile: s.mobile, state: 'OPTED_OUT' } })); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const res = await call('POST', '/api/whatsapp/campaigns', { token: admin, body: { name: 'After stop', templateId, params: ['{name}', 'x'], studentIds: [s.id] } });
    assert.equal(res.body.skipped, 1);
    assert.equal(callsTo(s.mobile).length, 0);
    assert.equal(await prisma.lead.count({ where: { phone: `91${s.mobile}` } }), 0, 'a STOP reply is not a sales lead');
  });

  it('failed sends retry automatically, and admins can retry eligible failures', async () => {
    whatsappMock.reset();
    const s = await createStudent(admin);
    whatsappMock.queue.push({ status: 400, body: { error: { message: 'Template paused', code: 132015 } } });
    const res = await call('POST', '/api/whatsapp/campaigns', { token: admin, body: { name: 'Will fail', templateId, params: ['{name}', 'x'], studentIds: [s.id] } });
    assert.equal(res.body.delivery.failed, 1);
    const log = await prisma.messageLog.findFirstOrThrow({ where: { campaignId: res.body.campaign.id } });
    assert.equal(log.status, 'FAILED');
    const retry = await call('POST', '/api/whatsapp/messages/retry', { token: admin, body: { ids: [log.id] } });
    assert.equal(retry.body.requeued, 1);
    assert.equal((await prisma.messageLog.findUniqueOrThrow({ where: { id: log.id } })).status, 'SENT');

    // Consent-skipped messages are not "retryable".
    const skipped = await prisma.messageLog.findFirstOrThrow({ where: { status: 'NO_CONSENT' } });
    const r2 = await call('POST', '/api/whatsapp/messages/retry', { token: admin, body: { ids: [skipped.id] } });
    assert.equal(r2.body.requeued, 0);
  });
});

// ───────────────────────── Razorpay payments ─────────────────────────

describe('Online payments (Razorpay)', () => {
  const sign = (orderId: string, paymentId: string) => crypto.createHmac('sha256', TEST_RZP_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  const webhook = (event: string, payload: unknown, opts: { eventId?: string; secret?: string } = {}) => {
    const body = JSON.stringify({ event, payload });
    const sig = crypto.createHmac('sha256', opts.secret ?? TEST_RZP_WEBHOOK_SECRET).update(body).digest('hex');
    return call('POST', '/webhooks/razorpay', {
      body,
      headers: { 'x-razorpay-signature': sig, 'x-razorpay-event-id': opts.eventId ?? `evt_${crypto.randomUUID()}` },
    });
  };

  async function linkedStudentWithInvoice(name = 'Paying Student') {
    const student = await createStudent(admin, { fullName: name });
    const enr = await enroll(admin, student.id, ref.hathaMonth.id, TODAY);
    const web = await signup({ mobile: student.mobile });
    await call('POST', `/api/website-logins/${web.account.id}/link`, { token: admin, body: { studentId: student.id } });
    return { student, web, invoiceId: enr.body.invoice.id as string };
  }

  it('pays an invoice: amount from the server, signature + gateway check, receipt issued, idempotent', async () => {
    const { web, invoiceId } = await linkedStudentWithInvoice();
    const order = await site('POST', '/api/account/payments/order', { session: web.token, body: { invoiceId, amountPaise: 1 } });
    assert.equal(order.status, 201);
    assert.equal(order.body.order.amountPaise, '250000', 'client-sent amount is ignored');
    assert.equal(order.body.checkout.keyId, 'rzp_test_mockkey');
    const gatewayOrderId = order.body.order.gatewayOrderId as string;

    // Forged success is refused.
    const pay = razorpayMock.pay(gatewayOrderId);
    const forged = await site('POST', '/api/account/payments/verify', {
      session: web.token,
      body: { razorpay_order_id: gatewayOrderId, razorpay_payment_id: pay.id, razorpay_signature: 'f'.repeat(64) },
    });
    assert.equal(forged.status, 400);
    assert.equal((await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status, 'UNPAID');

    const body = { razorpay_order_id: gatewayOrderId, razorpay_payment_id: pay.id, razorpay_signature: sign(gatewayOrderId, pay.id) };
    const ok = await site('POST', '/api/account/payments/verify', { session: web.token, body });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.order.status, 'PAID');
    const again = await site('POST', '/api/account/payments/verify', { session: web.token, body });
    assert.equal(again.body.order.status, 'PAID');

    // Webhook for the same payment (delivered twice) changes nothing.
    const entity = { ...pay };
    assert.equal((await webhook('payment.captured', { payment: { entity } }, { eventId: 'evt_dup_1' })).status, 200);
    const dup = await webhook('payment.captured', { payment: { entity } }, { eventId: 'evt_dup_1' });
    assert.equal(dup.body.duplicate, true);

    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { payments: { include: { receipt: true } } } });
    assert.equal(invoice.status, 'PAID');
    assert.equal(invoice.payments.length, 1, 'exactly one payment recorded');
    assert.equal(invoice.payments[0].mode, 'UPI');
    assert.ok(invoice.payments[0].receipt?.receiptNo);

    const dash = await site('GET', '/api/account/dashboard', { session: web.token });
    assert.equal(dash.body.payments.length, 1);
    const receipt = await site('GET', `/api/account/receipts/${dash.body.payments[0].receiptId}/pdf`, { session: web.token });
    assert.equal(receipt.raw.subarray(0, 5).toString(), '%PDF-');

    // Nothing left to pay.
    assert.equal((await site('POST', '/api/account/payments/order', { session: web.token, body: { invoiceId } })).status, 409);
  });

  it('a webhook that arrives before the browser returns still records the payment once', async () => {
    const { web, invoiceId } = await linkedStudentWithInvoice('Webhook First');
    const order = await site('POST', '/api/account/payments/order', { session: web.token, body: { invoiceId } });
    const pay = razorpayMock.pay(order.body.order.gatewayOrderId);
    assert.equal((await webhook('payment.captured', { payment: { entity: pay } })).status, 200);
    // Browser closed — the success page asks for the order status.
    const status = await site('GET', `/api/account/payments/orders/${order.body.order.id}`, { session: web.token });
    assert.equal(status.body.order.status, 'PAID');
    assert.equal(await prisma.payment.count({ where: { invoiceId } }), 1);
  });

  it('rejects webhooks with a bad signature', async () => {
    const res = await webhook('payment.captured', { payment: { entity: { id: 'pay_x' } } }, { secret: 'wrong' });
    assert.equal(res.status, 400);
  });

  it('an abandoned checkout is picked up by reconciliation', async () => {
    const { web, invoiceId } = await linkedStudentWithInvoice('Closed Tab');
    const order = await site('POST', '/api/account/payments/order', { session: web.token, body: { invoiceId } });
    razorpayMock.pay(order.body.order.gatewayOrderId, { status: 'authorized' });
    await prisma.paymentOrder.update({ where: { id: order.body.order.id }, data: { updatedAt: new Date(Date.now() - 20 * 60_000) } });
    const rec = await call('POST', '/api/payments/reconcile', { token: accountant });
    assert.equal(rec.status, 200);
    assert.ok(rec.body.summary.paid >= 1);
    assert.equal((await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status, 'PAID');
  });

  it('money that can no longer be applied is flagged for review, never lost or double-counted', async () => {
    const { web, invoiceId } = await linkedStudentWithInvoice('Paid Twice');
    const order = await site('POST', '/api/account/payments/order', { session: web.token, body: { invoiceId } });
    // Meanwhile the student pays cash at the desk.
    await call('POST', `/api/billing/invoices/${invoiceId}/payments`, { token: admin, body: { amountRupees: 2500, mode: 'CASH' } });
    const pay = razorpayMock.pay(order.body.order.gatewayOrderId);
    const v = await site('POST', '/api/account/payments/verify', {
      session: web.token,
      body: { razorpay_order_id: order.body.order.gatewayOrderId, razorpay_payment_id: pay.id, razorpay_signature: sign(order.body.order.gatewayOrderId, pay.id) },
    });
    assert.equal(v.body.order.status, 'NEEDS_REVIEW');
    assert.equal(await prisma.payment.count({ where: { invoiceId } }), 1, 'only the cash payment is on the invoice');
  });

  it('buys a plan online: creates the student record, enrolment, invoice and receipt', async () => {
    const web = await signup({ fullName: 'New Online Buyer' });
    const order = await site('POST', '/api/account/payments/order', { session: web.token, body: { coursePlanId: ref.hathaMonth.id, startDate: day(2) } });
    assert.equal(order.status, 201);
    assert.equal(order.body.order.amountPaise, '250000');
    const notSold = await site('POST', '/api/account/payments/order', { session: web.token, body: { coursePlanId: ref.hathaQuarter.id, startDate: day(2) } });
    assert.equal(notSold.status, 404, 'only plans marked "available online" can be bought');
    const past = await site('POST', '/api/account/payments/order', { session: web.token, body: { coursePlanId: ref.hathaMonth.id, startDate: day(-1) } });
    assert.equal(past.status, 400);

    const pay = razorpayMock.pay(order.body.order.gatewayOrderId, { method: 'card' });
    const v = await site('POST', '/api/account/payments/verify', {
      session: web.token,
      body: { razorpay_order_id: order.body.order.gatewayOrderId, razorpay_payment_id: pay.id, razorpay_signature: sign(order.body.order.gatewayOrderId, pay.id) },
    });
    assert.equal(v.body.order.status, 'PAID');
    const account = await prisma.customerAccount.findUniqueOrThrow({ where: { id: web.account.id }, include: { student: true } });
    assert.ok(account.student, 'a studio record was created and linked');
    const enrollment = await prisma.enrollment.findFirstOrThrow({ where: { studentId: account.studentId! }, include: { invoices: true } });
    assert.equal(enrollment.startDate.toISOString().slice(0, 10), day(2));
    assert.equal(enrollment.invoices[0].status, 'PAID');
  });

  it('refunds go through Razorpay, update the invoice once, and need the right role', async () => {
    const { web, invoiceId } = await linkedStudentWithInvoice('Refund Me');
    const order = await site('POST', '/api/account/payments/order', { session: web.token, body: { invoiceId } });
    const pay = razorpayMock.pay(order.body.order.gatewayOrderId);
    await webhook('payment.captured', { payment: { entity: pay } });
    const gp = await prisma.gatewayPayment.findUniqueOrThrow({ where: { gatewayPaymentId: pay.id } });

    assert.equal((await call('POST', `/api/payments/gateway-payments/${gp.id}/refund`, { token: frontDesk, body: { amountRupees: 500, reason: 'test' } })).status, 403);
    const tooMuch = await call('POST', `/api/payments/gateway-payments/${gp.id}/refund`, { token: accountant, body: { amountRupees: 99999, reason: 'Too much' } });
    assert.equal(tooMuch.status, 400);

    const refund = await call('POST', `/api/payments/gateway-payments/${gp.id}/refund`, { token: accountant, body: { amountRupees: 500, reason: 'Missed two classes' } });
    assert.equal(refund.status, 201);
    assert.equal(refund.body.refund.status, 'PROCESSED');
    let invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    assert.equal(invoice.amountPaidPaise, 200000n);
    assert.equal(invoice.status, 'PARTIAL');

    // Razorpay's refund.processed webhook for the same refund does not apply it again.
    const r = razorpayMock.refunds.at(-1)!;
    await webhook('refund.processed', { refund: { entity: { ...r, status: 'processed' } } });
    invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    assert.equal(invoice.amountPaidPaise, 200000n);
    assert.equal(await prisma.auditLog.count({ where: { action: 'REFUND_INITIATED' } }) >= 1, true);
  });

  it('admin payment dashboard lists orders and totals', async () => {
    const res = await call('GET', '/api/payments/orders?status=PAID', { token: accountant });
    assert.equal(res.status, 200);
    assert.ok(res.body.orders.length >= 3);
    assert.ok(res.body.orders.every((o: any) => !('passwordHash' in o.account)));
    const status = await call('GET', '/api/payments/status', { token: admin });
    assert.equal(status.body.razorpay.mode, 'test');
    assert.ok(!JSON.stringify(status.body).includes(TEST_RZP_SECRET));
    assert.equal(razorpayMock.badAuth, 0, 'every gateway call was authenticated');
  });
});

// ───────────────────────── Email sign-in (mobile still mandatory) ─────────────────────────

describe('Sign up and sign in with email', () => {
  const emailSignup = (body: Record<string, unknown>) =>
    site('POST', '/api/customer-auth/signup', { body: { method: 'EMAIL_PASSWORD', fullName: 'Email Person', password: 'Lotus2024', ...body } });

  it('an email sign-up still requires a mobile number, and the email', async () => {
    const noMobile = await emailSignup({ email: 'nomobile@example.com' });
    assert.equal(noMobile.status, 400);
    const noEmail = await emailSignup({ mobile: nextMobile() });
    assert.equal(noEmail.status, 400);
    assert.match(JSON.stringify(noEmail.body), /email/i);
  });

  it('signs in with the email (any case) or the mobile number', async () => {
    const mobile = nextMobile();
    const res = await emailSignup({ email: 'Asha.Rao@Example.COM', mobile });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.account.email, 'asha.rao@example.com', 'stored lower-case');
    assert.equal(res.body.account.mobile, mobile);
    assert.equal(res.body.account.signupMethod, 'EMAIL_PASSWORD');

    const byEmail = await site('POST', '/api/customer-auth/login', { body: { identifier: ' ASHA.rao@example.com ', password: 'Lotus2024' } });
    assert.equal(byEmail.status, 200);
    const byMobile = await site('POST', '/api/customer-auth/login', { body: { identifier: `+91 ${mobile}`, password: 'Lotus2024' } });
    assert.equal(byMobile.status, 200);
    const legacy = await site('POST', '/api/customer-auth/login', { body: { mobile, password: 'Lotus2024' } });
    assert.equal(legacy.status, 200, 'older clients sending { mobile } still work');

    const wrong = await site('POST', '/api/customer-auth/login', { body: { identifier: 'asha.rao@example.com', password: 'nope-nope1' } });
    const unknown = await site('POST', '/api/customer-auth/login', { body: { identifier: 'nobody@example.com', password: 'nope-nope1' } });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.body.error, 'Email or password is incorrect.');
    assert.equal(unknown.body.error, wrong.body.error, 'no hint whether the email is registered');
    const bad = await site('POST', '/api/customer-auth/login', { body: { identifier: 'not-an-email@', password: 'x' } });
    assert.equal(bad.status, 400);

    const event = await prisma.customerLoginEvent.findFirstOrThrow({ where: { accountId: res.body.account.id, method: 'EMAIL_PASSWORD', success: true, reason: null } });
    assert.ok(event);
    const list = await call('GET', '/api/website-logins?method=EMAIL_PASSWORD', { token: admin });
    assert.ok(list.body.accounts.some((a: any) => a.id === res.body.account.id));
  });

  it('one email per account, whatever the letter case, including profile changes', async () => {
    await emailSignup({ email: 'meera@example.com', mobile: nextMobile() });
    const dup = await emailSignup({ email: 'MEERA@example.com', mobile: nextMobile() });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.code, 'EMAIL_TAKEN');
    // A mobile sign-up that includes someone else's email is refused too.
    const viaMobile = await site('POST', '/api/customer-auth/signup', { body: { fullName: 'Other', mobile: nextMobile(), email: 'meera@example.com', password: 'Lotus2024' } });
    assert.equal(viaMobile.status, 409);

    const other = await signup();
    const steal = await site('PATCH', '/api/account/profile', { session: other.token, body: { fullName: 'Other Person', email: 'Meera@Example.com' } });
    assert.equal(steal.status, 409);
    const own = await site('PATCH', '/api/account/profile', { session: other.token, body: { fullName: 'Other Person', email: 'other.person@example.com' } });
    assert.equal(own.status, 200);
    assert.equal(own.body.account.email, 'other.person@example.com');
  });

  it('Google sign-up never takes over an email another account already uses', async () => {
    await emailSignup({ email: 'kiran@gmail.com', mobile: nextMobile() });
    const first = await site('POST', '/api/customer-auth/google', { body: { idToken: await googleIdToken({ sub: 'google-sub-email-1', email: 'Kiran@gmail.com' }) } });
    assert.equal(first.body.status, 'NEEDS_MOBILE');
    const done = await site('POST', '/api/customer-auth/google/complete', { body: { pendingToken: first.body.pendingToken, fullName: 'Kiran G', mobile: nextMobile() } });
    assert.equal(done.status, 409);
    assert.equal(done.body.code, 'EMAIL_TAKEN');
    assert.equal(await prisma.authIdentity.count({ where: { subject: 'google-sub-email-1' } }), 0);
  });
});
