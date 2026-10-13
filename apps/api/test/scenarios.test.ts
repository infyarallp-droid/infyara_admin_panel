// End-to-end API scenarios TC-01 … TC-20 from
// "Admin Page Testing — Observations, Required Business Logic & Test Scenarios".
// Every request goes through the real Express app, validation, Prisma and a
// real PostgreSQL test database. Only the WhatsApp provider is mocked.
import { whatsappMock, TEST_WHATSAPP_TOKEN } from './setup.js';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { syncCatalogue, CATALOGUE } from '../prisma/catalog.js';
import {
  call,
  createStudent,
  day,
  enroll,
  nextMobile,
  PNG_1PX,
  prisma,
  resetDatabase,
  SIGNATURE_DATA_URL,
  TODAY,
  tokenFor,
} from './helpers.js';

let ref: Awaited<ReturnType<typeof resetDatabase>>;
let admin: string;
let frontDesk: string;

before(async () => {
  ref = await resetDatabase();
  admin = await tokenFor('ADMIN');
  frontDesk = await tokenFor('FRONT_DESK');
});

const csvFile = (text: string, name = 'legacy.csv', type = 'text/csv') => {
  const fd = new FormData();
  fd.append('file', new Blob([text], { type }), name);
  return fd;
};
const isPdf = (buf: Buffer) => buf.subarray(0, 5).toString('latin1') === '%PDF-';

describe('TC-01 Course catalogue', () => {
  it('lists every requested course exactly once with the right category and delivery mode', async () => {
    await syncCatalogue(prisma); // a repeated sync must not duplicate anything
    const res = await call('GET', '/api/courses', { token: admin });
    assert.equal(res.status, 200);
    for (const entry of CATALOGUE) {
      const found = res.body.courses.filter((c: any) => c.name === entry.name);
      assert.equal(found.length, 1, `${entry.name} should appear exactly once`);
      assert.equal(found[0].category, entry.category);
      assert.equal(found[0].deliveryMode, entry.deliveryMode);
      assert.equal(found[0].code, entry.code);
    }
    const names = res.body.courses.map((c: any) => c.name.toLowerCase());
    assert.equal(new Set(names).size, names.length, 'no duplicate course names');
  });

  it('offers the new courses in the enrolment selection and flags what is still unconfigured', async () => {
    const res = await call('GET', '/api/courses?active=true', { token: frontDesk });
    const aerial = res.body.courses.find((c: any) => c.code === 'TRN-AERIAL-YOGA');
    assert.ok(aerial, 'Aerial Yoga Training is selectable');
    assert.equal(aerial.deliveryMode, 'OFFLINE');
    assert.deepEqual(aerial.plans, [], 'no fee/plan was invented');
    assert.ok(aerial.setupPending.includes('plan, duration and fee'));
    const matPilates = res.body.courses.filter((c: any) => /mat pilates/i.test(c.name));
    assert.equal(matPilates.length, 1, 'Mat Pilates is one programme, not two');
    assert.equal(matPilates[0].deliveryMode, 'HYBRID');
  });

  it('refuses a second course with the same name', async () => {
    const res = await call('POST', '/api/courses', { token: admin, body: { name: 'aerial yoga training', category: 'TEACHER_TRAINING' } });
    assert.equal(res.status, 409);
  });
});

describe('TC-02 Existing student match', () => {
  it('finds the existing student by mobile or email and never creates a duplicate master', async () => {
    const mobile = nextMobile();
    const s = await createStudent(admin, { mobile, email: 'Match.Me@Example.com' });
    assert.match(s.studentCode, /^STU-\d{4,}$/);

    const byMobile = await call('GET', `/api/students/match?mobile=${encodeURIComponent('+91 ' + mobile)}`, { token: frontDesk });
    assert.equal(byMobile.body.matches.length, 1);
    assert.equal(byMobile.body.matches[0].id, s.id);
    assert.deepEqual(byMobile.body.matches[0].matchedOn, ['mobile']);

    const byEmail = await call('GET', '/api/students/match?email=match.me@example.com', { token: frontDesk });
    assert.equal(byEmail.body.matches[0].id, s.id);

    const before = await prisma.student.count();
    const dupMobile = await call('POST', '/api/students', { token: frontDesk, body: { fullName: 'Someone Else', mobile } });
    assert.equal(dupMobile.status, 409);
    assert.equal(dupMobile.body.code, 'STUDENT_EXISTS');
    assert.equal(dupMobile.body.existing.id, s.id);

    const dupEmail = await call('POST', '/api/students', {
      token: frontDesk,
      body: { fullName: 'Same Email', mobile: nextMobile(), email: 'match.me@example.com' },
    });
    assert.equal(dupEmail.status, 409);
    assert.equal(dupEmail.body.code, 'POSSIBLE_DUPLICATE');
    assert.equal(await prisma.student.count(), before, 'no duplicate student master was created');

    // A genuinely different person sharing a family email can still be added — deliberately.
    const confirmed = await call('POST', '/api/students', {
      token: frontDesk,
      body: { fullName: 'Family Member', mobile: nextMobile(), email: 'match.me@example.com', confirmDifferentPerson: true },
    });
    assert.equal(confirmed.status, 201);
  });

  it('rejects malformed contact details with a clear message', async () => {
    const badMobile = await call('POST', '/api/students', { token: admin, body: { fullName: 'Bad Mobile', mobile: '12345' } });
    assert.equal(badMobile.status, 400);
    assert.match(badMobile.body.error, /mobile/i);
    const badEmail = await call('POST', '/api/students', { token: admin, body: { fullName: 'Bad Email', mobile: nextMobile(), email: 'nope' } });
    assert.equal(badEmail.status, 400);
    const noName = await call('POST', '/api/students', { token: admin, body: { fullName: '', mobile: nextMobile() } });
    assert.equal(noName.status, 400);
  });
});

describe('TC-03 Multiple courses for one student', () => {
  it('records two separate enrolments, each with its own invoice, under one student', async () => {
    const s = await createStudent(admin, { email: 'multi@example.com' });
    const students = await prisma.student.count();

    const a = await enroll(frontDesk, s.id, ref.hathaMonth.id, TODAY);
    const b = await enroll(frontDesk, s.id, ref.pilatesPlan.id, TODAY);
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.notEqual(a.body.enrollment.id, b.body.enrollment.id);
    assert.notEqual(a.body.invoice.id, b.body.invoice.id);
    assert.equal(a.body.invoice.enrollmentId, a.body.enrollment.id);
    assert.equal(b.body.invoice.totalPaise, '300000');

    assert.equal(await prisma.student.count(), students, 'still one student master');
    const profile = await call('GET', `/api/students/${s.id}`, { token: frontDesk });
    assert.equal(profile.body.student.enrollments.length, 2);
    const courses = profile.body.student.enrollments.map((e: any) => e.coursePlan.course.name).sort();
    assert.deepEqual(courses, ['Hatha Yoga', 'Pilates Classes']);
    for (const e of profile.body.student.enrollments) {
      assert.equal(e.payment.status, 'UNPAID');
      assert.ok(e.startDate && e.endDate && e.displayStatus);
    }
  });
});

describe('TC-04 Duplicate enrolment prevention', () => {
  it('blocks the same course for an overlapping period, but keeps legitimate history', async () => {
    const s = await createStudent(admin);
    assert.equal((await enroll(admin, s.id, ref.hathaMonth.id, TODAY)).status, 201);

    const same = await enroll(admin, s.id, ref.hathaMonth.id, TODAY);
    assert.equal(same.status, 409);
    assert.equal(same.body.code, 'DUPLICATE_ENROLLMENT');
    assert.match(same.body.error, /already enrolled in Hatha Yoga/);

    const otherPlan = await enroll(admin, s.id, ref.hathaQuarter.id, day(10));
    assert.equal(otherPlan.status, 409, 'same course on a different plan still overlaps');

    // Even with the override flag, it is refused while the business has not enabled overrides.
    const forced = await enroll(admin, s.id, ref.hathaMonth.id, TODAY, { allowDuplicate: true, overrideReason: 'testing override' });
    assert.equal(forced.status, 409);
    assert.equal(forced.body.canOverride, false);

    const later = await enroll(admin, s.id, ref.hathaMonth.id, day(31));
    assert.equal(later.status, 201, 'a later, non-overlapping period is a legitimate new enrolment');
    assert.equal(await prisma.enrollment.count({ where: { studentId: s.id } }), 2);
  });

  it('creates exactly one enrolment when the same request is submitted 5 times at once', async () => {
    const s = await createStudent(admin);
    const results = await Promise.all(Array.from({ length: 5 }, () => enroll(admin, s.id, ref.hathaMonth.id, TODAY)));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(results.filter((r) => r.status === 409).length, 4);
    assert.equal(await prisma.enrollment.count({ where: { studentId: s.id } }), 1);
    assert.equal(await prisma.invoice.count({ where: { studentId: s.id } }), 1);
  });

  it('rejects an end date before the start date', async () => {
    const s = await createStudent(admin);
    const res = await enroll(admin, s.id, ref.hathaMonth.id, TODAY, { endDate: day(-1) });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Start date cannot be later than the end date/);
    const badDate = await enroll(admin, s.id, ref.hathaMonth.id, '2026-02-30');
    assert.equal(badDate.status, 400);
  });
});

describe('TC-05 Joining date in Students list and Renewals Due', () => {
  it('shows the joining/start date in both lists', async () => {
    const s = await createStudent(admin);
    await enroll(admin, s.id, ref.hathaMonth.id, day(-28)); // ends in 2 days → in Renewals Due
    await enroll(admin, s.id, ref.pilatesPlan.id, day(-5));

    const list = await call('GET', `/api/students?search=${s.mobile}`, { token: frontDesk });
    assert.equal(list.body.items.length, 1);
    assert.equal(list.body.items[0].joiningDate, day(-28), 'joining date = first enrolment start');
    assert.equal(list.body.items[0].studentCode, s.studentCode);

    const due = await call('GET', '/api/enrollments/renewals-due?days=30', { token: frontDesk });
    const row = due.body.enrollments.find((e: any) => e.studentId === s.id && e.coursePlan.course.name === 'Hatha Yoga');
    assert.ok(row, 'enrolment appears in Renewals Due');
    assert.equal(row.startDate.slice(0, 10), day(-28));
    assert.equal(row.joiningDate.slice(0, 10), day(-28));
    assert.equal(row.endDate.slice(0, 10), day(2));
    assert.equal(row.daysRemaining, 2);
    assert.equal(row.student.fullName, s.fullName);
    assert.equal(row.displayStatus, 'RENEWAL_DUE');
  });
});

describe('TC-06/07/08/09 Status rules', () => {
  it('TC-06: a future start date is Upcoming, not Active', async () => {
    const s = await createStudent(admin);
    const res = await enroll(admin, s.id, ref.hathaMonth.id, day(5));
    assert.equal(res.body.enrollment.displayStatus, 'UPCOMING');
    assert.match(res.body.enrollment.statusReason, new RegExp(day(5)));
    const profile = await call('GET', `/api/students/${s.id}`, { token: admin });
    assert.equal(profile.body.student.computedStatus, 'UPCOMING');
  });

  it('TC-07: an enrolment inside its date range is Active', async () => {
    const s = await createStudent(admin);
    const res = await enroll(admin, s.id, ref.hathaMonth.id, day(-5));
    assert.equal(res.body.enrollment.displayStatus, 'ACTIVE');
    assert.equal(res.body.enrollment.daysRemaining, 25);
    const profile = await call('GET', `/api/students/${s.id}`, { token: admin });
    assert.equal(profile.body.student.computedStatus, 'ACTIVE');
  });

  it('TC-08: a past end date with no renewal is Expired and shows in Renewals Due', async () => {
    const s = await createStudent(admin);
    const res = await enroll(admin, s.id, ref.hathaMonth.id, day(-40));
    assert.equal(res.body.enrollment.displayStatus, 'EXPIRED');
    assert.equal(res.body.enrollment.daysRemaining, -10);

    const due = await call('GET', '/api/enrollments/renewals-due?days=7', { token: admin });
    assert.ok(due.body.enrollments.some((e: any) => e.id === res.body.enrollment.id && e.displayStatus === 'EXPIRED'));

    const profile = await call('GET', `/api/students/${s.id}`, { token: admin });
    assert.equal(profile.body.student.computedStatus, 'INACTIVE');
    assert.equal(profile.body.student.statusManual, false);
    assert.match(profile.body.student.statusReason, /expired or cancelled/);
  });

  it('TC-09: one expired + one active enrolment leaves the student Active', async () => {
    const s = await createStudent(admin);
    const expired = await enroll(admin, s.id, ref.hathaMonth.id, day(-40));
    const active = await enroll(admin, s.id, ref.pilatesPlan.id, day(-3));
    const profile = await call('GET', `/api/students/${s.id}`, { token: admin });
    assert.equal(profile.body.student.computedStatus, 'ACTIVE');
    const byId = Object.fromEntries(profile.body.student.enrollments.map((e: any) => [e.id, e.displayStatus]));
    assert.equal(byId[expired.body.enrollment.id], 'EXPIRED', 'the expired enrolment stays expired');
    assert.equal(byId[active.body.enrollment.id], 'ACTIVE');
    const list = await call('GET', `/api/students?search=${s.mobile}`, { token: admin });
    assert.equal(list.body.items[0].computedStatus, 'ACTIVE');
  });

  it('manual deactivation needs a reason, is audited, blocks new enrolments and can be reversed', async () => {
    const s = await createStudent(admin);
    await enroll(admin, s.id, ref.hathaMonth.id, day(-3));
    const manager = await tokenFor('MANAGER');

    assert.equal((await call('POST', `/api/students/${s.id}/deactivate`, { token: manager, body: {} })).status, 400);
    const future = await call('POST', `/api/students/${s.id}/deactivate`, { token: manager, body: { reason: 'Moved away', effectiveDate: day(3) } });
    assert.equal(future.status, 400);
    assert.equal((await call('POST', `/api/students/${s.id}/deactivate`, { token: frontDesk, body: { reason: 'Moved away' } })).status, 403);

    const ok = await call('POST', `/api/students/${s.id}/deactivate`, { token: manager, body: { reason: 'Moved away', effectiveDate: day(-1) } });
    assert.equal(ok.status, 200);
    const profile = await call('GET', `/api/students/${s.id}`, { token: admin });
    assert.equal(profile.body.student.computedStatus, 'INACTIVE');
    assert.equal(profile.body.student.statusManual, true);
    assert.match(profile.body.student.statusReason, /Moved away/);
    assert.equal(profile.body.student.statusEffectiveDate, day(-1));

    const blocked = await enroll(admin, s.id, ref.pilatesPlan.id, TODAY);
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error, /deactivated/);

    assert.equal((await call('POST', `/api/students/${s.id}/reactivate`, { token: manager, body: {} })).status, 200);
    const history = await call('GET', `/api/students/${s.id}/status-history`, { token: admin });
    assert.deepEqual(history.body.history.map((h: any) => h.action), ['STUDENT_REACTIVATED', 'STUDENT_DEACTIVATED']);
    assert.equal(history.body.history[1].meta.reason, 'Moved away');
    assert.equal(history.body.history[1].user.name, 'Test MANAGER');
    assert.equal((await enroll(admin, s.id, ref.pilatesPlan.id, TODAY)).status, 201);
  });
});

describe('TC-10 Renewal start date and expiry calculation', () => {
  it('renews from the chosen start date, keeps the original period, and cannot be repeated', async () => {
    const s = await createStudent(admin);
    const first = await enroll(admin, s.id, ref.hathaMonth.id, day(-28)); // ends day(2)
    const oldId = first.body.enrollment.id;

    const due = await call('GET', '/api/enrollments/renewals-due?days=30', { token: admin });
    const row = due.body.enrollments.find((e: any) => e.id === oldId);
    assert.equal(due.body.config.renewalStartDefault, 'TODAY');
    assert.equal(row.suggestedRenewalStart, TODAY);
    assert.equal(row.suggestedNextExpiry, day(30));
    assert.equal(row.durationDays, 30);

    const tooEarly = await call('POST', `/api/enrollments/${oldId}/renew`, { token: admin, body: { startDate: day(-60) } });
    assert.equal(tooEarly.status, 400);

    const renewal = await call('POST', `/api/enrollments/${oldId}/renew`, { token: admin, body: { startDate: day(3), discountRupees: 200 } });
    assert.equal(renewal.status, 201);
    assert.deepEqual(renewal.body.renewal, {
      previousExpiry: day(2),
      renewalStart: day(3),
      nextExpiry: day(33),
      renewedFromEnrollmentId: oldId,
    });
    assert.equal(renewal.body.enrollment.startDate.slice(0, 10), day(3));
    assert.equal(renewal.body.enrollment.endDate.slice(0, 10), day(33));
    assert.equal(renewal.body.enrollment.parentEnrollmentId, oldId);
    assert.equal(renewal.body.invoice.type, 'RENEWAL');
    assert.equal(renewal.body.invoice.totalPaise, '230000', 'plan fee 2500 less 200 discount');
    assert.equal(renewal.body.invoice.enrollmentId, renewal.body.enrollment.id);

    const again = await call('POST', `/api/enrollments/${oldId}/renew`, { token: admin, body: { startDate: day(3) } });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'ALREADY_RENEWED');
    assert.equal(again.body.renewalEnrollmentId, renewal.body.enrollment.id);

    const detail = await call('GET', `/api/enrollments/${renewal.body.enrollment.id}`, { token: admin });
    assert.equal(detail.body.originalJoiningDate.slice(0, 10), day(-28), 'original joining date preserved');
    assert.equal(detail.body.history.length, 2);
    // Renewed ahead of time: the original period is still the one in use until the renewal starts.
    assert.deepEqual(detail.body.history.map((h: any) => h.displayStatus), ['ACTIVE', 'UPCOMING']);
    assert.match(detail.body.history[0].statusReason, /renewed, next period starts/);
    const afterRenewal = await call('GET', `/api/students/${s.id}`, { token: admin });
    assert.equal(afterRenewal.body.student.computedStatus, 'ACTIVE', 'student stays Active between renewal and its start');
    assert.equal(detail.body.history[0].startDate.slice(0, 10), day(-28));

    const list = await call('GET', `/api/students?search=${s.mobile}`, { token: admin });
    assert.equal(list.body.items[0].joiningDate, day(-28));
    assert.equal(await prisma.enrollment.count({ where: { studentId: s.id } }), 2);
  });

  it('creates one renewal when Renew is clicked several times at once', async () => {
    const s = await createStudent(admin);
    const first = await enroll(admin, s.id, ref.hathaMonth.id, day(-29));
    const id = first.body.enrollment.id;
    const results = await Promise.all(Array.from({ length: 4 }, () => call('POST', `/api/enrollments/${id}/renew`, { token: admin, body: {} })));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(results.filter((r) => r.status === 409).length, 3);
    assert.equal(await prisma.enrollment.count({ where: { parentEnrollmentId: id } }), 1);
    assert.equal(await prisma.invoice.count({ where: { studentId: s.id, type: 'RENEWAL' } }), 1);
    const ok = results.find((r) => r.status === 201)!;
    assert.equal(ok.body.renewal.renewalStart, TODAY, 'no start date given → configured default (today)');
    // Renewal already running → the old period is closed (Renewed), not shown as a second Active.
    const profile = await call('GET', `/api/students/${s.id}`, { token: admin });
    const statuses = profile.body.student.enrollments.map((e: any) => e.displayStatus).sort();
    assert.deepEqual(statuses, ['ACTIVE', 'RENEWED']);
  });
});

describe('TC-11 Legacy bulk upload — valid file', () => {
  it('downloads the template, previews, imports valid rows and reports accurate counts', async () => {
    const tpl = await call('GET', '/api/students/import/template', { token: admin });
    assert.equal(tpl.status, 200);
    assert.match(tpl.headers.get('content-type') ?? '', /text\/csv/);
    const header = tpl.raw.toString('utf8').replace(/^[^A-Za-z]+/, '').trim();
    assert.equal(
      header,
      'Student ID,Full Name,Mobile Number,Email,Date of Birth,Gender,Address,Emergency Contact Name,Emergency Contact Number,Course Name or Code,Joining Date,Plan / Duration,Expiry Date,Fee,Amount Paid,Balance,Payment Status,Status',
    );

    const existing = await createStudent(admin, { fullName: 'Existing Legacy' });
    const [m1, m2] = [nextMobile(), nextMobile()];
    const csv = [
      header,
      `LEG-001,Legacy One,${m1},legacy.one@example.com,15-08-1990,Female,"12, Temple Road",Kin One,${nextMobile()},HATHA,${day(-10)},1 Month,,2500,2500,0,Paid,Active`,
      `,Legacy Two,+91 ${m2},,,,,,,Hatha Yoga,${day(-5).split('-').reverse().join('-')},3 Months,,6500,2000,4500,Partial,`,
      `,Existing Legacy,${existing.mobile},,,,,,,Pilates Classes,${day(-2)},1 Month,,,,,,`,
    ].join('\r\n');

    const preview = await call('POST', '/api/students/import/preview', { token: admin, form: csvFile(csv) });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.deepEqual(preview.body.fileErrors, []);
    assert.deepEqual(preview.body.summary, {
      totalRows: 3,
      importableRows: 3,
      newStudents: 2,
      existingStudents: 1,
      enrollmentsToCreate: 3,
      duplicateRows: 0,
      invalidRows: 0,
    });
    assert.equal(preview.body.rows[2].status, 'EXISTING_STUDENT');
    assert.equal(await prisma.student.count({ where: { mobile: { in: [m1, m2] } } }), 0, 'preview writes nothing');

    const commit = await call('POST', '/api/students/import/commit', { token: admin, form: csvFile(csv) });
    assert.equal(commit.status, 200, JSON.stringify(commit.body));
    assert.deepEqual(
      { ...commit.body.summary },
      { totalRows: 3, importedRows: 3, skippedRows: 0, failedRows: 0, studentsCreated: 2, studentsUpdated: 0, enrollmentsCreated: 3, paymentsCreated: 2, updatePolicy: 'skip' },
    );

    const one = await prisma.student.findUniqueOrThrow({
      where: { mobile: m1 },
      include: { enrollments: { include: { invoices: { include: { payments: true } } } } },
    });
    assert.equal(one.studentCode, 'LEG-001');
    assert.equal(one.dob?.toISOString().slice(0, 10), '1990-08-15');
    assert.equal(one.address, '12, Temple Road');
    assert.equal(one.enrollments[0].endDate.toISOString().slice(0, 10), day(20), 'expiry calculated from plan');
    assert.equal(one.enrollments[0].invoices[0].status, 'PAID');
    assert.equal(one.enrollments[0].invoices[0].payments[0].amountPaise, 250000n);

    const two = await prisma.student.findUniqueOrThrow({ where: { mobile: m2 }, include: { enrollments: { include: { invoices: true } } } });
    assert.match(two.studentCode ?? '', /^STU-/, 'Student ID generated when absent');
    assert.equal(two.enrollments[0].invoices[0].status, 'PARTIAL');
    assert.equal(two.enrollments[0].invoices[0].amountPaidPaise, 200000n);
    assert.equal(two.enrollments[0].startDate.toISOString().slice(0, 10), day(-5), 'DD-MM-YYYY date accepted');

    assert.equal(await prisma.enrollment.count({ where: { studentId: existing.id } }), 1, 'course added to the existing student');
    assert.equal(await prisma.student.count({ where: { mobile: existing.mobile } }), 1);

    // Uploading the same file again must not import anything twice.
    const counts = async () => [await prisma.student.count(), await prisma.enrollment.count(), await prisma.payment.count(), await prisma.invoice.count()];
    const beforeCounts = await counts();
    const again = await call('POST', '/api/students/import/commit', { token: admin, form: csvFile(csv) });
    assert.equal(again.body.summary.importedRows, 0);
    assert.equal(again.body.summary.skippedRows, 3);
    assert.deepEqual(await counts(), beforeCounts);
  });

  it('never overwrites existing student details; "fill blanks" only fills empty fields', async () => {
    const s = await createStudent(admin, { fullName: 'Keep My Name', address: 'Original Address' });
    const csv = `Full Name,Mobile Number,Email,Address\r\nChanged Name,${s.mobile},filled@example.com,New Address\r\n`;

    const skip = await call('POST', '/api/students/import/commit', { token: admin, form: csvFile(csv) });
    assert.equal(skip.body.summary.importedRows, 0);
    let row = await prisma.student.findUniqueOrThrow({ where: { id: s.id } });
    assert.equal(row.email, null);

    const fd = csvFile(csv);
    fd.append('updatePolicy', 'fill_blanks');
    const fill = await call('POST', '/api/students/import/commit', { token: admin, form: fd });
    assert.equal(fill.body.summary.studentsUpdated, 1);
    row = await prisma.student.findUniqueOrThrow({ where: { id: s.id } });
    assert.equal(row.email, 'filled@example.com', 'blank field filled');
    assert.equal(row.fullName, 'Keep My Name', 'existing name kept');
    assert.equal(row.address, 'Original Address', 'existing address kept');
  });
});

describe('TC-12 Legacy bulk upload — invalid rows', () => {
  it('reports each invalid row with its reason and imports only the valid one', async () => {
    const good = nextMobile();
    const dup = nextMobile();
    const H = 'Full Name,Mobile Number,Email,Course Name or Code,Joining Date,Plan / Duration,Expiry Date,Fee,Amount Paid,Balance,Payment Status';
    const csv = [
      H,
      `Good Row,${good},good@example.com,HATHA,${day(-3)},1 Month,,2500,0,2500,Unpaid`, // 2 valid
      `Bad Date,${nextMobile()},,HATHA,31-02-2026,1 Month,,,,,`, // 3
      `Unknown Course,${nextMobile()},,Zumba Blast,${day(-3)},1 Month,,,,,`, // 4
      `Bad Mobile,98765,,HATHA,${day(-3)},1 Month,,,,,`, // 5
      `Bad Email,${nextMobile()},not-an-email,HATHA,${day(-3)},1 Month,,,,,`, // 6
      `Dup Row,${dup},,HATHA,${day(-3)},1 Month,,,,,`, // 7 valid
      `Dup Row,${dup},,HATHA,${day(-1)},1 Month,,,,,`, // 8 duplicate of 7
      `Expiry Early,${nextMobile()},,HATHA,${day(-3)},1 Month,${day(-9)},,,,`, // 9
      `Overpaid,${nextMobile()},,HATHA,${day(-3)},1 Month,,2500,3000,,`, // 10
      `Bad Balance,${nextMobile()},,HATHA,${day(-3)},1 Month,,2500,1000,500,`, // 11
      `Wrong Status,${nextMobile()},,HATHA,${day(-3)},1 Month,,2500,1000,1500,Paid`, // 12
      `Negative Fee,${nextMobile()},,HATHA,${day(-3)},1 Month,,-100,,,`, // 13
      `No Plan,${nextMobile()},,TRN-AERIAL-YOGA,${day(-3)},1 Month,,,,,`, // 14
      `,${nextMobile()},,,,,,,,,`, // 15 missing name
    ].join('\n');

    const preview = await call('POST', '/api/students/import/preview', { token: admin, form: csvFile(csv) });
    assert.equal(preview.status, 200);
    const reason = (rowNumber: number) => {
      const r = preview.body.rows.find((x: any) => x.rowNumber === rowNumber);
      return `${r.status}: ${r.errors.join(' | ')} ${r.action}`;
    };
    assert.match(reason(3), /INVALID: .*Joining Date "31-02-2026" is not a valid date/);
    assert.match(reason(4), /INVALID: .*Course "Zumba Blast" does not match any course/);
    assert.match(reason(5), /INVALID: .*not a valid 10-digit mobile/);
    assert.match(reason(6), /INVALID: .*Email "not-an-email" is not valid/);
    assert.match(reason(8), /DUPLICATE: .*duplicates row 7/);
    assert.match(reason(9), /INVALID: .*Expiry Date cannot be earlier than Joining Date/);
    assert.match(reason(10), /INVALID: .*Amount Paid is more than the Fee/);
    assert.match(reason(11), /INVALID: .*Balance does not reconcile/);
    assert.match(reason(12), /INVALID: .*does not agree with Fee and Amount Paid/);
    assert.match(reason(13), /INVALID: .*not a valid non-negative amount/);
    assert.match(reason(14), /INVALID: .*has no plans configured yet/);
    assert.match(reason(15), /INVALID: .*Full Name is required/);
    assert.equal(preview.body.summary.invalidRows, 11);
    assert.equal(preview.body.summary.duplicateRows, 1);
    assert.equal(preview.body.summary.importableRows, 2);

    const before = { students: await prisma.student.count(), payments: await prisma.payment.count() };
    const commit = await call('POST', '/api/students/import/commit', { token: admin, form: csvFile(csv) });
    assert.equal(commit.body.summary.totalRows, 14);
    assert.equal(commit.body.summary.importedRows, 2);
    assert.equal(commit.body.summary.skippedRows, 1);
    assert.equal(commit.body.summary.failedRows, 11);
    assert.equal(await prisma.student.count(), before.students + 2, 'only the two valid students were created');
    assert.equal(await prisma.payment.count(), before.payments, 'no financial data from invalid rows');
    assert.equal(await prisma.enrollment.count({ where: { student: { mobile: dup } } }), 1);
  });

  it('rejects the wrong file type or structure outright', async () => {
    const xlsx = await call('POST', '/api/students/import/preview', { token: admin, form: csvFile('PK\u0003\u0004binary', 'students.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') });
    assert.equal(xlsx.status, 400);
    assert.match(xlsx.body.error, /Excel workbooks are not accepted/);

    const unknown = await call('POST', '/api/students/import/preview', { token: admin, form: csvFile('Full Name,Mobile Number,Favourite Colour\nA B,9000000001,red\n') });
    assert.match(unknown.body.fileErrors[0], /Unknown column "Favourite Colour"/);

    const missing = await call('POST', '/api/students/import/preview', { token: admin, form: csvFile('Full Name,Email\nA B,a@b.co\n') });
    assert.match(missing.body.fileErrors[0], /Required column "Mobile Number" is missing/);
    const refused = await call('POST', '/api/students/import/commit', { token: admin, form: csvFile('Full Name,Email\nA B,a@b.co\n') });
    assert.equal(refused.status, 400);

    const noFile = await call('POST', '/api/students/import/preview', { token: admin, form: new FormData() });
    assert.equal(noFile.status, 400);
    const forbidden = await call('POST', '/api/students/import/preview', { token: frontDesk, form: csvFile('Full Name,Mobile Number\n') });
    assert.equal(forbidden.status, 403);
  });
});

async function newConsent(studentOverrides: Record<string, unknown> = {}) {
  const s = await createStudent(admin, studentOverrides);
  const enr = await enroll(admin, s.id, ref.hathaMonth.id, TODAY);
  const form = await call('POST', '/api/consent/forms', { token: frontDesk, body: { studentId: s.id, enrollmentId: enr.body.enrollment.id, formDate: TODAY } });
  assert.equal(form.status, 201, JSON.stringify(form.body));
  return { student: s, enrollment: enr.body.enrollment, invoice: enr.body.invoice, formId: form.body.form.id as string };
}
const ACKS = { consentSafetyAck: true, studioPoliciesAck: true, codeOfConductAck: true, finalAck: true };

describe('TC-13 Consent form — draft, finalise, PDF', () => {
  it('creates the form for the right student/enrolment, finalises it and serves a valid PDF', async () => {
    const { student, formId } = await newConsent();

    // The exact case that produced "Internal server error": a form linked to an enrolment (fee line with ₹).
    const loaded = await call('GET', `/api/consent/forms/${formId}`, { token: frontDesk });
    assert.equal(loaded.body.form.student.id, student.id);
    assert.equal(loaded.body.form.courseName, 'Hatha Yoga');
    assert.equal(loaded.body.form.planTitle, '1 Month');
    assert.equal(loaded.body.form.feePaise, '250000');
    assert.equal(loaded.body.form.templateVersion, 1);

    const save = await call('PUT', `/api/consent/forms/${formId}`, {
      token: frontDesk,
      body: { ...ACKS, healthFlags: { bp: true }, healthOther: 'Mild asthma', studentSignatureDataUrl: SIGNATURE_DATA_URL, studentSignedDate: TODAY },
    });
    assert.equal(save.status, 200);

    const draftPdf = await call('GET', `/api/consent/forms/${formId}/pdf`, { token: frontDesk });
    assert.equal(draftPdf.status, 200);
    assert.ok(isPdf(draftPdf.raw), 'draft can be printed for a paper signature');

    const fin = await call('POST', `/api/consent/forms/${formId}/finalize`, { token: frontDesk });
    assert.equal(fin.status, 200, JSON.stringify(fin.body));
    assert.equal(fin.body.form.status, 'FINALIZED');
    assert.ok(fin.body.form.finalizedAt);
    assert.equal(fin.body.pdfPath, `/api/consent/forms/${formId}/pdf`);

    const pdf = await call('GET', fin.body.pdfPath, { token: frontDesk });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.match(pdf.headers.get('content-disposition') ?? '', /^inline; filename="consent-/);
    const doc = await PDFDocument.load(pdf.raw);
    assert.ok(doc.getPageCount() >= 1);
    assert.equal(doc.getTitle(), `Consent form - ${student.fullName}`, 'PDF belongs to the selected student');

    assert.equal((await call('GET', fin.body.pdfPath)).status, 401, 'PDF is not public');
  });

  it('does not create duplicate drafts and finalises only once', async () => {
    const { student, enrollment, formId } = await newConsent();
    const repeat = await call('POST', '/api/consent/forms', { token: frontDesk, body: { studentId: student.id, enrollmentId: enrollment.id, formDate: TODAY } });
    assert.equal(repeat.status, 200);
    assert.equal(repeat.body.reused, true);
    assert.equal(repeat.body.form.id, formId);

    await call('PUT', `/api/consent/forms/${formId}`, { token: frontDesk, body: { ...ACKS, studentSignatureDataUrl: SIGNATURE_DATA_URL } });
    const results = await Promise.all([1, 2, 3].map(() => call('POST', `/api/consent/forms/${formId}/finalize`, { token: frontDesk })));
    assert.ok(results.every((r) => r.status === 200));
    assert.equal(results.filter((r) => r.body.alreadyFinalized === false).length, 1, 'finalised exactly once');
    assert.equal(await prisma.consentForm.count({ where: { studentId: student.id } }), 1);

    const edit = await call('PUT', `/api/consent/forms/${formId}`, { token: frontDesk, body: { healthOther: 'tamper' } });
    assert.equal(edit.status, 409);
    const row = await prisma.consentForm.findUniqueOrThrow({ where: { id: formId } });
    assert.equal(row.healthOther, null, 'a finalised form cannot be changed');
  });

  it('explains what is missing instead of failing, and keeps the draft', async () => {
    const { formId } = await newConsent();
    await call('PUT', `/api/consent/forms/${formId}`, { token: frontDesk, body: { consentSafetyAck: true, healthOther: 'keep me' } });
    const noAcks = await call('POST', `/api/consent/forms/${formId}/finalize`, { token: frontDesk });
    assert.equal(noAcks.status, 400);
    assert.match(noAcks.body.error, /Section 3 \(Studio Policies\).*Section 5/);

    await call('PUT', `/api/consent/forms/${formId}`, { token: frontDesk, body: ACKS });
    const noSig = await call('POST', `/api/consent/forms/${formId}/finalize`, { token: frontDesk });
    assert.equal(noSig.status, 400);
    assert.match(noSig.body.error, /signature is required/i);

    const row = await prisma.consentForm.findUniqueOrThrow({ where: { id: formId } });
    assert.equal(row.status, 'DRAFT');
    assert.equal(row.healthOther, 'keep me', 'draft data preserved');

    const badSig = await call('PUT', `/api/consent/forms/${formId}`, { token: frontDesk, body: { studentSignatureDataUrl: 'data:text/html;base64,PGI+' } });
    assert.equal(badSig.status, 400);
  });

  it('generates the PDF for names and notes the PDF font cannot encode', async () => {
    const { formId } = await newConsent({ fullName: 'రమ్య Kumar ₹', emergencyContactName: 'अमित', emergencyContactRelation: 'père' });
    await call('PUT', `/api/consent/forms/${formId}`, { token: frontDesk, body: { ...ACKS, healthOther: 'Fee paid ₹500 — “ok” 😀', studentSignatureDataUrl: SIGNATURE_DATA_URL } });
    const fin = await call('POST', `/api/consent/forms/${formId}/finalize`, { token: frontDesk });
    assert.equal(fin.status, 200, JSON.stringify(fin.body));
    const pdf = await call('GET', `/api/consent/forms/${formId}/pdf`, { token: frontDesk });
    assert.ok(isPdf(pdf.raw));
  });

  it('rejects a consent form for an enrolment that belongs to another student', async () => {
    const a = await newConsent();
    const b = await createStudent(admin);
    const res = await call('POST', '/api/consent/forms', { token: frontDesk, body: { studentId: b.id, enrollmentId: a.enrollment.id, formDate: TODAY } });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /different student/);
  });
});

describe('TC-14 Signed consent upload', () => {
  it('stores the signed scan against the correct consent record and serves it only to staff', async () => {
    const { student, formId } = await newConsent();
    const other = await newConsent();

    const fd = new FormData();
    fd.append('file', new Blob([PNG_1PX], { type: 'image/png' }), 'Signed Copy.png');
    const up = await call('POST', `/api/consent/forms/${formId}/uploads`, { token: frontDesk, form: fd });
    assert.equal(up.status, 201, JSON.stringify(up.body));
    assert.equal(up.body.upload.consentFormId, formId);
    assert.equal(up.body.upload.fileName, 'Signed Copy.png');
    assert.equal(up.body.upload.mimeType, 'image/png');
    assert.equal(up.body.upload.sizeBytes, PNG_1PX.length);

    const file = await call('GET', `/api/consent/uploads/${up.body.upload.id}/file`, { token: frontDesk });
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'image/png');
    assert.ok(file.raw.equals(PNG_1PX), 'stored file is byte-identical');
    assert.equal((await call('GET', `/api/consent/uploads/${up.body.upload.id}/file`)).status, 401);

    const profile = await call('GET', `/api/students/${student.id}`, { token: frontDesk });
    assert.equal(profile.body.student.consentForms[0].id, formId);
    assert.equal(profile.body.student.consentForms[0].uploads.length, 1);
    const otherForm = await call('GET', `/api/consent/forms/${other.formId}`, { token: frontDesk });
    assert.equal(otherForm.body.form.uploads.length, 0, 'not attached to another student’s form');

    // Paper flow: acknowledgements + uploaded signed copy are enough to finalise.
    await call('PUT', `/api/consent/forms/${formId}`, { token: frontDesk, body: ACKS });
    assert.equal((await call('POST', `/api/consent/forms/${formId}/finalize`, { token: frontDesk })).status, 200);
  });

  it('rejects unsupported or missing files with a clear message', async () => {
    const { formId } = await newConsent();
    const fd = new FormData();
    fd.append('file', new Blob(['<script>'], { type: 'text/html' }), 'x.html');
    const bad = await call('POST', `/api/consent/forms/${formId}/uploads`, { token: frontDesk, form: fd });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /photo .* or a PDF/);
    assert.equal((await call('POST', `/api/consent/forms/${formId}/uploads`, { token: frontDesk, form: new FormData() })).status, 400);
    assert.equal(await prisma.consentUpload.count({ where: { consentFormId: formId } }), 0);
  });
});

async function unpaidInvoice() {
  const s = await createStudent(admin);
  const enr = await enroll(admin, s.id, ref.hathaMonth.id, TODAY);
  return { student: s, enrollment: enr.body.enrollment, invoiceId: enr.body.invoice.id as string };
}
const pay = (invoiceId: string, body: unknown, token?: string, headers?: Record<string, string>) =>
  call('POST', `/api/billing/invoices/${invoiceId}/payments`, { token: token ?? admin, body, headers });

describe('TC-15 Payment recording', () => {
  it('records a full payment and updates paid, balance, status, history, receipt and PDFs', async () => {
    const { student, enrollment, invoiceId } = await unpaidInvoice();
    const accountant = await tokenFor('ACCOUNTANT');
    const res = await pay(invoiceId, { amountRupees: 2500, mode: 'CARD', referenceNo: 'TXN-123', idempotencyKey: `key-${invoiceId}` }, accountant);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.payment.amountPaise, '250000');
    assert.equal(res.body.payment.mode, 'CARD');
    assert.equal(res.body.payment.referenceNo, 'TXN-123');
    assert.match(res.body.receipt.receiptNo, /^MW-RCPT\/\d{4}-\d{2}\/\d{4}$/);

    const inv = await call('GET', `/api/billing/invoices/${invoiceId}`, { token: accountant });
    assert.equal(inv.body.invoice.status, 'PAID');
    assert.equal(inv.body.invoice.amountPaidPaise, '250000');
    assert.equal(inv.body.invoice.payments.length, 1);
    assert.equal(inv.body.invoice.payments[0].receipt.receiptNo, res.body.receipt.receiptNo);
    assert.equal(inv.body.invoice.enrollment.id, enrollment.id, 'payment is tied to the right enrolment');
    assert.equal(inv.body.invoice.student.id, student.id);

    const receiptPdf = await call('GET', `/api/billing/receipts/${res.body.receipt.id}/pdf`, { token: accountant });
    assert.equal(receiptPdf.status, 200);
    assert.ok(isPdf(receiptPdf.raw));
    const invoicePdf = await call('GET', `/api/billing/invoices/${invoiceId}/pdf`, { token: accountant });
    assert.ok(isPdf(invoicePdf.raw));
    assert.equal((await call('GET', `/api/billing/invoices/${invoiceId}/pdf`)).status, 401);

    const profile = await call('GET', `/api/students/${student.id}`, { token: admin });
    assert.equal(profile.body.student.enrollments[0].payment.status, 'PAID');
    assert.equal(profile.body.student.enrollments[0].payment.balancePaise, '0');
  });

  it('records a renewal payment against the renewal invoice', async () => {
    const s = await createStudent(admin);
    const first = await enroll(admin, s.id, ref.hathaMonth.id, day(-29));
    const renewal = await call('POST', `/api/enrollments/${first.body.enrollment.id}/renew`, { token: admin, body: { startDate: day(2) } });
    const res = await pay(renewal.body.invoice.id, { amountRupees: 2500, mode: 'UPI', paidOn: TODAY });
    assert.equal(res.status, 201);
    const inv = await call('GET', `/api/billing/invoices/${renewal.body.invoice.id}`, { token: admin });
    assert.equal(inv.body.invoice.type, 'RENEWAL');
    assert.equal(inv.body.invoice.status, 'PAID');
    const original = await call('GET', `/api/billing/invoices/${first.body.invoice.id}`, { token: admin });
    assert.equal(original.body.invoice.status, 'UNPAID', 'the original invoice is untouched');
  });

  it('enforces who may record payments', async () => {
    const { invoiceId } = await unpaidInvoice();
    assert.equal((await pay(invoiceId, { amountRupees: 100, mode: 'CASH' }, await tokenFor('TRAINER'))).status, 403);
    assert.equal((await call('POST', `/api/billing/invoices/${invoiceId}/payments`, { body: { amountRupees: 100, mode: 'CASH' } })).status, 401);
    assert.equal(await prisma.payment.count({ where: { invoiceId } }), 0);
  });
});

describe('TC-16 Partial payment', () => {
  it('keeps the balance correct across partial payments', async () => {
    const { invoiceId } = await unpaidInvoice();
    const p1 = await pay(invoiceId, { amountRupees: 1000.5, mode: 'CASH' });
    assert.equal(p1.status, 201);
    assert.equal(p1.body.invoice.status, 'PARTIAL');
    assert.equal(p1.body.invoice.amountPaidPaise, '100050');

    const p2 = await pay(invoiceId, { amountRupees: 1499.5, mode: 'BANK_TRANSFER', paidOn: day(-1) });
    assert.equal(p2.status, 201);
    assert.equal(p2.body.invoice.status, 'PAID');
    assert.notEqual(p1.body.receipt.receiptNo, p2.body.receipt.receiptNo);

    const inv = await call('GET', `/api/billing/invoices/${invoiceId}`, { token: admin });
    assert.equal(inv.body.invoice.payments.length, 2);
    const sum = inv.body.invoice.payments.reduce((t: number, p: any) => t + Number(p.amountPaise), 0);
    assert.equal(sum, 250000);
    assert.equal(sum, Number(inv.body.invoice.amountPaidPaise), 'invoice total paid = sum of payments');
  });
});

describe('TC-17 Invalid payment amounts', () => {
  it('rejects zero, negative, malformed and excessive amounts without recording anything', async () => {
    const { invoiceId } = await unpaidInvoice();
    const cases: [unknown, RegExp][] = [
      [{ amountRupees: 0, mode: 'CASH' }, /greater than zero/],
      [{ amountRupees: -50, mode: 'CASH' }, /greater than zero/],
      [{ amountRupees: 'abc', mode: 'CASH' }, /must be a number/],
      [{ amountRupees: null, mode: 'CASH' }, /must be a number/],
      [{ mode: 'CASH' }, /Amount is required/],
      [{ amountRupees: 10.555, mode: 'CASH' }, /at most 2 decimal places/],
      [{ amountRupees: 2500.01, mode: 'CASH' }, /exceeds the outstanding balance of Rs\. 2,500\.00/],
      [{ amountRupees: 100, mode: 'CHEQUE' }, /Choose a payment mode/],
      [{ amountRupees: 100, mode: 'CASH', paidOn: day(1) }, /cannot be in the future/],
      [{ amountRupees: 100, mode: 'CASH', paidOn: 'yesterday' }, /not a valid date/],
    ];
    for (const [body, message] of cases) {
      const res = await pay(invoiceId, body);
      assert.equal(res.status, 400, `${JSON.stringify(body)} → ${JSON.stringify(res.body)}`);
      assert.match(res.body.error, message);
    }
    const malformed = await pay(invoiceId, '{"amountRupees": 12,');
    assert.equal(malformed.status, 400);

    assert.equal(await prisma.payment.count({ where: { invoiceId } }), 0);
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    assert.equal(inv.status, 'UNPAID');
    assert.equal(inv.amountPaidPaise, 0n);

    assert.equal((await pay(invoiceId, { amountRupees: 2500, mode: 'CASH' })).status, 201);
    const extra = await pay(invoiceId, { amountRupees: 1, mode: 'CASH' });
    assert.equal(extra.status, 409);
    assert.match(extra.body.error, /already fully paid/);

    assert.equal((await pay('not-a-uuid', { amountRupees: 1, mode: 'CASH' })).status, 400);
    assert.equal((await pay('00000000-0000-4000-8000-000000000000', { amountRupees: 1, mode: 'CASH' })).status, 404);
  });
});

describe('TC-18 Duplicate payment submission', () => {
  it('returns the original payment when the same submission is retried', async () => {
    const { invoiceId } = await unpaidInvoice();
    const key = `retry-${invoiceId}`;
    const first = await pay(invoiceId, { amountRupees: 1000, mode: 'UPI' }, admin, { 'Idempotency-Key': key });
    assert.equal(first.status, 201);
    const retry = await pay(invoiceId, { amountRupees: 1000, mode: 'UPI' }, admin, { 'Idempotency-Key': key });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.duplicate, true);
    assert.equal(retry.body.payment.id, first.body.payment.id);
    assert.equal(retry.body.receipt.receiptNo, first.body.receipt.receiptNo);
    assert.equal(await prisma.payment.count({ where: { invoiceId } }), 1);
    assert.equal((await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).amountPaidPaise, 100000n);

    const misuse = await pay(invoiceId, { amountRupees: 500, mode: 'UPI' }, admin, { 'Idempotency-Key': key });
    assert.equal(misuse.status, 409, 'a key cannot be reused for a different amount');
  });

  it('records one payment for 6 simultaneous clicks with the same key', async () => {
    const { invoiceId } = await unpaidInvoice();
    const body = { amountRupees: 2500, mode: 'CASH', idempotencyKey: `burst-${invoiceId}` };
    const results = await Promise.all(Array.from({ length: 6 }, () => pay(invoiceId, body)));
    assert.ok(results.every((r) => r.status === 200 || r.status === 201), JSON.stringify(results.map((r) => r.body)));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(new Set(results.map((r) => r.body.payment.id)).size, 1);
    assert.equal(await prisma.payment.count({ where: { invoiceId } }), 1);
    assert.equal(await prisma.receipt.count({ where: { payment: { invoiceId } } }), 1);
  });

  it('never over-collects when clients without a key submit concurrently', async () => {
    const { invoiceId } = await unpaidInvoice();
    const results = await Promise.all(Array.from({ length: 5 }, () => pay(invoiceId, { amountRupees: 2500, mode: 'CASH' })));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.ok(results.filter((r) => r.status !== 201).every((r) => r.status === 409));
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    assert.equal(inv.amountPaidPaise, inv.totalPaise);
    assert.equal(await prisma.payment.count({ where: { invoiceId } }), 1);
  });

  it('issues unique invoice and receipt numbers under concurrency', async () => {
    const students = await Promise.all(Array.from({ length: 6 }, () => createStudent(admin)));
    const enrolled = await Promise.all(students.map((s) => enroll(admin, s.id, ref.hathaMonth.id, TODAY)));
    assert.ok(enrolled.every((r) => r.status === 201), 'no invoice-number collisions');
    const paid = await Promise.all(enrolled.map((r) => pay(r.body.invoice.id, { amountRupees: 500, mode: 'CASH' })));
    assert.ok(paid.every((r) => r.status === 201), 'no receipt-number collisions');
    const receipts = paid.map((r) => r.body.receipt.receiptNo);
    assert.equal(new Set(receipts).size, receipts.length);
  });
});

describe('TC-19 WhatsApp reminders', () => {
  const run = () => call('POST', '/api/automations/run-reminders', { token: admin });
  const callsTo = (mobile: string) => whatsappMock.calls.filter((c) => c.to === `91${mobile}`);

  it('sends one renewal reminder per window, logs it, and does not repeat it', async () => {
    whatsappMock.reset();
    const s = await createStudent(admin, { fullName: 'Reminder Target' });
    const enr = await enroll(admin, s.id, ref.hathaMonth.id, day(-27)); // ends in 3 days

    const status = await call('GET', '/api/automations/whatsapp-status', { token: admin });
    assert.equal(status.body.whatsapp.configured, true);
    assert.deepEqual(status.body.whatsapp.reminderDays, [1, 3, 7]);
    assert.ok(!JSON.stringify(status.body).includes(TEST_WHATSAPP_TOKEN));

    const first = await run();
    assert.equal(first.status, 200);
    assert.equal(callsTo(s.mobile).length, 1);
    const sent = callsTo(s.mobile)[0];
    assert.equal(sent.template, 'renewal_reminder');
    assert.deepEqual(sent.params, ['Reminder Target', 'Hatha Yoga (1 Month)', day(3)]);
    assert.equal(sent.authorization, `Bearer ${TEST_WHATSAPP_TOKEN}`);

    const logs = await call('GET', `/api/automations/messages?enrollmentId=${enr.body.enrollment.id}`, { token: admin });
    assert.equal(logs.body.messages.length, 1);
    const log = logs.body.messages[0];
    assert.equal(log.status, 'SENT');
    assert.equal(log.event, 'RENEWAL_REMINDER');
    assert.equal(log.recipient, `91${s.mobile}`);
    assert.match(log.providerMessageId, /^wamid\.TEST/);
    assert.ok(log.sentAt);
    assert.match(log.triggeredBy, /^MANUAL:/);
    assert.ok(!JSON.stringify(logs.body).includes(TEST_WHATSAPP_TOKEN), 'credentials never reach the log');

    const second = await run();
    assert.equal(callsTo(s.mobile).length, 1, 'same reminder window → not sent again');
    assert.ok(second.body.summary.whatsappDuplicate >= 1);
    const manual = await call('POST', `/api/automations/renewal-reminder/${enr.body.enrollment.id}`, { token: admin });
    assert.equal(manual.body.outcome, 'DUPLICATE');
    assert.equal(callsTo(s.mobile).length, 1);

    // Delivery receipt from the provider webhook updates the same log row.
    const receipt = await call('POST', '/webhooks/whatsapp', {
      body: { entry: [{ changes: [{ value: { statuses: [{ id: log.providerMessageId, status: 'delivered' }] } }] }] },
    });
    assert.equal(receipt.status, 200);
    for (let i = 0; i < 40; i++) {
      const row = await prisma.messageLog.findUniqueOrThrow({ where: { id: log.id } });
      if (row.status === 'DELIVERED') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal((await prisma.messageLog.findUniqueOrThrow({ where: { id: log.id } })).status, 'DELIVERED');

    const due = await call('GET', '/api/enrollments/renewals-due?days=7', { token: admin });
    assert.equal(due.body.enrollments.find((e: any) => e.id === enr.body.enrollment.id).lastReminder.status, 'DELIVERED');
  });

  it('never calls the provider for an invalid recipient, and logs why', async () => {
    whatsappMock.reset();
    const s = await createStudent(admin, { mobile: '1234567890' }); // 10 digits but not a mobile number
    const enr = await enroll(admin, s.id, ref.hathaMonth.id, day(-27));
    await run();
    assert.equal(whatsappMock.calls.filter((c) => c.to?.includes('1234567890')).length, 0);
    const log = await prisma.messageLog.findFirstOrThrow({ where: { enrollmentId: enr.body.enrollment.id } });
    assert.equal(log.status, 'INVALID_RECIPIENT');
  });

  it('logs a provider failure and retries it on the next run', async () => {
    const s = await createStudent(admin);
    const enr = await enroll(admin, s.id, ref.hathaMonth.id, day(-29)); // ends in 1 day
    await run(); // flush reminders owed to other test students
    await prisma.messageLog.deleteMany({ where: { enrollmentId: enr.body.enrollment.id } });
    whatsappMock.reset();
    whatsappMock.queue.push({ status: 500, body: { error: { message: 'Temporary provider error', code: 131000 } } });

    const failed = await run();
    assert.equal(failed.body.summary.whatsappFailed, 1);
    let log = await prisma.messageLog.findFirstOrThrow({ where: { enrollmentId: enr.body.enrollment.id } });
    assert.equal(log.status, 'FAILED');
    assert.equal(log.error, 'Temporary provider error');
    assert.equal(log.attempts, 1);
    assert.deepEqual(log.providerResponse, { error: { message: 'Temporary provider error', code: 131000 } });

    await run();
    log = await prisma.messageLog.findFirstOrThrow({ where: { enrollmentId: enr.body.enrollment.id } });
    assert.equal(log.status, 'SENT');
    assert.equal(log.attempts, 2);
    assert.equal(callsTo(s.mobile).length, 2);
  });

  it('stops calling the provider for the rest of the run when rate limited', async () => {
    const students = await Promise.all([1, 2, 3].map(() => createStudent(admin)));
    await run(); // flush anything pending
    for (const s of students) await enroll(admin, s.id, ref.hathaMonth.id, day(-23)); // each ends in 7 days
    whatsappMock.reset();
    whatsappMock.queue.push({ status: 429, body: { error: { message: 'Rate limit hit', code: 130429 } } });

    const limited = await run();
    assert.equal(limited.body.summary.rateLimited, true);
    assert.equal(whatsappMock.calls.length, 1, 'no further provider calls after the 429');

    const next = await run();
    assert.equal(next.body.summary.rateLimited, false);
    assert.equal(next.body.summary.whatsappSent, 3, 'the limited one is retried and the rest are sent');
    for (const s of students) assert.equal(callsTo(s.mobile).filter(() => true).length >= 1, true);
    assert.equal(await prisma.messageLog.count({ where: { studentId: { in: students.map((s) => s.id) }, status: 'SENT' } }), 3);
  });

  it('is not open to roles without permission', async () => {
    assert.equal((await call('POST', '/api/automations/run-reminders', { token: frontDesk })).status, 403);
    assert.equal((await call('GET', '/api/automations/messages', { token: frontDesk })).status, 403);
  });
});

describe('TC-20 Error handling and regression (consent + payments)', () => {
  it('returns clear 4xx errors — never an unexplained 500 — for bad ids and missing records', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    const checks: [string, string, number][] = [
      ['GET', `/api/consent/forms/${missing}`, 404],
      ['GET', '/api/consent/forms/not-a-uuid', 400],
      ['POST', `/api/consent/forms/${missing}/finalize`, 404],
      ['GET', `/api/consent/forms/${missing}/pdf`, 404],
      ['GET', `/api/billing/invoices/${missing}`, 404],
      ['GET', `/api/billing/invoices/${missing}/pdf`, 404],
      ['GET', `/api/billing/receipts/${missing}/pdf`, 404],
      ['GET', '/api/billing/invoices/xyz', 400],
      ['GET', `/api/students/${missing}`, 404],
      ['GET', '/api/students/xyz', 400],
      ['GET', `/api/enrollments/${missing}`, 404],
      ['POST', `/api/enrollments/${missing}/renew`, 404],
    ];
    for (const [method, path, expected] of checks) {
      const res = await call(method, path, { token: admin, body: method === 'POST' ? {} : undefined });
      assert.equal(res.status, expected, `${method} ${path} → ${res.status} ${JSON.stringify(res.body)}`);
      assert.equal(res.body.ok, false);
      assert.ok(typeof res.body.error === 'string' && res.body.error.length > 3);
    }
    const noStudent = await call('POST', '/api/consent/forms', { token: admin, body: { studentId: missing, formDate: TODAY } });
    assert.equal(noStudent.status, 404);
    const noEnrolStudent = await enroll(admin, missing, ref.hathaMonth.id, TODAY);
    assert.equal(noEnrolStudent.status, 404);
  });

  it('a failed payment leaves no partial financial records', async () => {
    const { invoiceId } = await unpaidInvoice();
    const before = { payments: await prisma.payment.count(), receipts: await prisma.receipt.count() };
    const counter = await prisma.counter.findMany();
    const res = await pay(invoiceId, { amountRupees: 99999, mode: 'CASH' });
    assert.equal(res.status, 400);
    assert.deepEqual({ payments: await prisma.payment.count(), receipts: await prisma.receipt.count() }, before);
    assert.deepEqual(await prisma.counter.findMany(), counter, 'no receipt number was consumed');
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    assert.equal(inv.amountPaidPaise, 0n);
  });

  it('existing flows still work: invoice list, plan pricing with discount, generic invoice, product-free regression', async () => {
    const s = await createStudent(admin);
    const enr = await enroll(admin, s.id, ref.hathaMonth.id, TODAY, { discountRupees: 300 });
    assert.equal(enr.body.invoice.totalPaise, '220000');
    assert.equal(enr.body.invoice.discountPaise ?? '0', '0'); // discount is netted into the line, as before
    assert.match(enr.body.invoice.invoiceNo, /^MW\/\d{4}-\d{2}\/\d{4}$/);

    const list = await call('GET', `/api/billing/invoices?studentId=${s.id}`, { token: admin });
    assert.equal(list.body.invoices.length, 1);

    const tooMuch = await enroll(admin, (await createStudent(admin)).id, ref.hathaMonth.id, TODAY, { discountRupees: 9999 });
    assert.equal(tooMuch.status, 400);

    // Complimentary enrolment: fully discounted → nothing owed, so the invoice is PAID.
    const free = await enroll(admin, (await createStudent(admin)).id, ref.hathaMonth.id, TODAY, { discountRupees: 2500 });
    assert.equal(free.status, 201);
    assert.equal(free.body.invoice.status, 'PAID');
    assert.equal(free.body.enrollment.payment.status, 'PAID');

    const second = await call('POST', `/api/billing/invoices/from-enrollment/${enr.body.enrollment.id}`, { token: admin, body: {} });
    assert.equal(second.status, 409, 'an enrolment is not billed twice');

    const custom = await call('POST', '/api/billing/invoices', {
      token: admin,
      body: { studentId: s.id, items: [{ itemType: 'CUSTOM', description: 'Workshop', qty: 2, unitPriceRupees: 750 }] },
    });
    assert.equal(custom.status, 201);
    assert.equal(custom.body.invoice.totalPaise, '150000');

    const del = await call('DELETE', `/api/students/${s.id}`, { token: admin });
    assert.equal(del.status, 409, 'a student with history is never cascade-deleted');
    assert.equal(await prisma.enrollment.count({ where: { studentId: s.id } }), 1);
  });
});
