// Zoom classes: staff manage online class links per course; a signed-in student sees only
// the links of the courses (and batch) they are currently enrolled in.
import { TEST_SERVICE_KEY } from './setup.js';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { call, createStudent, day, enroll, nextMobile, prisma, resetDatabase, TODAY, tokenFor } from './helpers.js';

let ref: Awaited<ReturnType<typeof resetDatabase>>;
let admin: string;
let frontDesk: string;
let trainer: string;

before(async () => {
  ref = await resetDatabase();
  admin = await tokenFor('ADMIN');
  frontDesk = await tokenFor('FRONT_DESK');
  trainer = await tokenFor('TRAINER');
});

let ipSeq = 1;
function site(method: string, path: string, session: string) {
  return call(method, path, { headers: { 'x-service-key': TEST_SERVICE_KEY, 'x-client-ip': `10.9.0.${ipSeq++ % 250}`, authorization: `Bearer ${session}` } });
}

/** A student with a website login linked to their record (and optionally an enrolment). */
async function linkedStudent(name: string) {
  const student = await createStudent(admin, { fullName: name });
  const signup = await call('POST', '/api/customer-auth/signup', {
    headers: { 'x-service-key': TEST_SERVICE_KEY, 'x-client-ip': `10.9.1.${ipSeq++ % 250}` },
    body: { fullName: name, mobile: student.mobile, password: 'Lotus2024', whatsappOptIn: false },
  });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  const link = await call('POST', `/api/website-logins/${signup.body.account.id}/link`, { token: admin, body: { studentId: student.id } });
  assert.equal(link.status, 200, JSON.stringify(link.body));
  return { student, session: signup.body.token as string };
}

const titles = async (session: string) => {
  const dash = await site('GET', '/api/account/dashboard', session);
  assert.equal(dash.status, 200, JSON.stringify(dash.body));
  return (dash.body.zoomClasses as { title: string }[]).map((z) => z.title).sort();
};

const weekly = (courseId: string, title: string, extra: Record<string, unknown> = {}) => ({
  courseId,
  title,
  meetingUrl: 'https://us02web.zoom.us/j/12345678901?pwd=abc',
  meetingId: '123 4567 8901',
  passcode: 'lotus',
  days: ['MON', 'WED', 'FRI'],
  startTime: '07:00',
  durationMinutes: 60,
  ...extra,
});

describe('Zoom classes', () => {
  it('only managers create classes; the link, schedule and batch are validated', async () => {
    assert.equal((await call('POST', '/api/zoom-classes', { token: frontDesk, body: weekly(ref.hatha.id, 'Nope') })).status, 403);
    assert.equal((await call('GET', '/api/zoom-classes', { token: trainer })).status, 200);

    const http = await call('POST', '/api/zoom-classes', { token: admin, body: weekly(ref.hatha.id, 'Plain http', { meetingUrl: 'http://zoom.us/j/1' }) });
    assert.equal(http.status, 400);
    const noDays = await call('POST', '/api/zoom-classes', { token: admin, body: weekly(ref.hatha.id, 'No days', { days: [] }) });
    assert.equal(noDays.status, 400);

    const otherTiming = await prisma.classTiming.create({ data: { courseId: ref.pilates.id, label: 'Pilates 6pm' } });
    const wrongBatch = await call('POST', '/api/zoom-classes', { token: admin, body: weekly(ref.hatha.id, 'Wrong batch', { classTimingId: otherTiming.id }) });
    assert.equal(wrongBatch.status, 400);

    const ok = await call('POST', '/api/zoom-classes', { token: admin, body: weekly(ref.hatha.id, 'Hatha online') });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.deepEqual(ok.body.item.days, ['MON', 'WED', 'FRI']);
    assert.equal(await prisma.auditLog.count({ where: { action: 'ZOOM_CLASS_CREATED', entityId: ok.body.item.id } }), 1);
  });

  it('a student sees the classes of their current courses and batch only', async () => {
    const morning = await prisma.classTiming.create({ data: { courseId: ref.hatha.id, label: 'Morning 7am' } });
    await call('POST', '/api/zoom-classes', { token: admin, body: weekly(ref.hatha.id, 'Hatha morning batch', { classTimingId: morning.id }) });
    await call('POST', '/api/zoom-classes', { token: admin, body: weekly(ref.pilates.id, 'Pilates online') });
    const future = new Date(Date.now() + 3 * 86400_000).toISOString();
    const past = new Date(Date.now() - 3 * 86400_000).toISOString();
    await call('POST', '/api/zoom-classes', { token: admin, body: weekly(ref.hatha.id, 'Hatha workshop', { startsAt: future, days: [], startTime: '' }) });
    await call('POST', '/api/zoom-classes', { token: admin, body: weekly(ref.hatha.id, 'Old workshop', { startsAt: past, days: [], startTime: '' }) });
    const hidden = await call('POST', '/api/zoom-classes', { token: admin, body: weekly(ref.hatha.id, 'Paused class', { isActive: false }) });
    assert.equal(hidden.status, 201);

    // Hatha, no batch: the course-wide classes, not the morning-batch one, nor Pilates.
    const a = await linkedStudent('Asha Hatha');
    assert.equal((await enroll(admin, a.student.id, ref.hathaMonth.id, TODAY)).status, 201);
    assert.deepEqual(await titles(a.session), ['Hatha online', 'Hatha workshop']);

    // Hatha, morning batch: also the batch class.
    const b = await linkedStudent('Bina Morning');
    assert.equal((await enroll(admin, b.student.id, ref.hathaMonth.id, TODAY, { classTimingId: morning.id })).status, 201);
    assert.deepEqual(await titles(b.session), ['Hatha morning batch', 'Hatha online', 'Hatha workshop']);

    // Starting next week: links are already there.
    const c = await linkedStudent('Chitra Soon');
    assert.equal((await enroll(admin, c.student.id, ref.pilatesPlan.id, day(5))).status, 201);
    assert.deepEqual(await titles(c.session), ['Pilates online']);

    // Ended enrolment: nothing.
    const d = await linkedStudent('Deepa Ended');
    assert.equal((await enroll(admin, d.student.id, ref.hathaMonth.id, day(-90))).status, 201);
    assert.deepEqual(await titles(d.session), []);

    // Cancelled enrolment: nothing.
    const e = await linkedStudent('Esha Cancelled');
    const enr = await enroll(admin, e.student.id, ref.hathaMonth.id, TODAY);
    await prisma.enrollment.update({ where: { id: enr.body.enrollment.id }, data: { status: 'CANCELLED' } });
    assert.deepEqual(await titles(e.session), []);

    // The dashboard carries the joining details.
    const dash = await site('GET', '/api/account/dashboard', a.session);
    const hatha = dash.body.zoomClasses.find((z: any) => z.title === 'Hatha online');
    assert.equal(hatha.meetingUrl, 'https://us02web.zoom.us/j/12345678901?pwd=abc');
    assert.equal(hatha.passcode, 'lotus');
    assert.equal(hatha.course, 'Hatha Yoga');

    // Switching a class off removes it at once.
    const list = await call('GET', `/api/zoom-classes?courseId=${ref.hatha.id}`, { token: admin });
    const online = list.body.items.find((z: any) => z.title === 'Hatha online');
    assert.equal((await call('PATCH', `/api/zoom-classes/${online.id}/active`, { token: admin, body: { isActive: false } })).status, 200);
    assert.deepEqual(await titles(a.session), ['Hatha workshop']);
    await call('PATCH', `/api/zoom-classes/${online.id}/active`, { token: admin, body: { isActive: true } });
  });

  it('a website account not yet linked to a student sees no links', async () => {
    const student = await createStudent(admin, { fullName: 'Unlinked Uma' });
    assert.equal((await enroll(admin, student.id, ref.hathaMonth.id, TODAY)).status, 201);
    const signup = await call('POST', '/api/customer-auth/signup', {
      headers: { 'x-service-key': TEST_SERVICE_KEY, 'x-client-ip': '10.9.2.1' },
      body: { fullName: 'Unlinked Uma', mobile: student.mobile, password: 'Lotus2024', whatsappOptIn: false },
    });
    const dash = await site('GET', '/api/account/dashboard', signup.body.token);
    assert.equal(dash.body.linked, false);
    assert.deepEqual(dash.body.zoomClasses, []);
    assert.ok(!JSON.stringify(dash.body).includes('zoom.us'));
  });

  it('staff see who each class is shared with, including who has no website login', async () => {
    const list = await call('GET', `/api/zoom-classes?courseId=${ref.hatha.id}`, { token: frontDesk });
    assert.equal(list.status, 200);
    const online = list.body.items.find((z: any) => z.title === 'Hatha online');
    const batch = list.body.items.find((z: any) => z.title === 'Hatha morning batch');
    // Asha, Bina, Uma (current Hatha); not the ended or cancelled ones.
    assert.equal(online.studentCount, 3);
    assert.equal(batch.studentCount, 1);
    assert.equal(list.body.items.find((z: any) => z.title === 'Old workshop').finished, true);

    const who = await call('GET', `/api/zoom-classes/${online.id}/students`, { token: admin });
    assert.equal(who.status, 200);
    assert.deepEqual(
      who.body.students.map((s: any) => [s.fullName, s.hasWebsiteLogin]),
      [
        ['Asha Hatha', true],
        ['Bina Morning', true],
        ['Unlinked Uma', false],
      ],
    );
  });

  it('managers edit and delete classes', async () => {
    const created = await call('POST', '/api/zoom-classes', { token: admin, body: weekly(ref.pilates.id, 'Temp', { meetingUrl: `https://zoom.us/j/${nextMobile()}` }) });
    const edit = await call('PUT', `/api/zoom-classes/${created.body.item.id}`, { token: admin, body: weekly(ref.pilates.id, 'Temp renamed', { days: ['SUN', 'MON'] }) });
    assert.equal(edit.status, 200);
    assert.equal(edit.body.item.title, 'Temp renamed');
    assert.deepEqual(edit.body.item.days, ['MON', 'SUN']);
    assert.equal((await call('DELETE', `/api/zoom-classes/${created.body.item.id}`, { token: frontDesk })).status, 403);
    assert.equal((await call('DELETE', `/api/zoom-classes/${created.body.item.id}`, { token: admin })).status, 200);
    assert.equal((await call('DELETE', `/api/zoom-classes/${created.body.item.id}`, { token: admin })).status, 404);
  });
});
