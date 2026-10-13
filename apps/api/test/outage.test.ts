// TC-20 (root-cause regression) + TC-19 (not-configured path).
//
// Before the fix, an unreachable/misconfigured file store turned "Add payment",
// "Save draft" (with a signature) and "Finalize" into `Internal server error`,
// because the upload ran inside the request (and, for payments, inside the DB
// transaction). This file runs the API with storage deliberately unreachable.
import './outage-env.js';
import { whatsappMock } from './setup.js';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { call, createStudent, day, enroll, PNG_1PX, prisma, resetDatabase, SIGNATURE_DATA_URL, TODAY, tokenFor } from './helpers.js';

let ref: Awaited<ReturnType<typeof resetDatabase>>;
let admin: string;

before(async () => {
  ref = await resetDatabase();
  admin = await tokenFor('ADMIN');
});

describe('TC-20 Payments and consent do not depend on file storage', () => {
  it('records a payment and serves the receipt while storage is unreachable', async () => {
    const s = await createStudent(admin);
    const enr = await enroll(admin, s.id, ref.hathaMonth.id, TODAY);
    const res = await call('POST', `/api/billing/invoices/${enr.body.invoice.id}/payments`, {
      token: admin,
      body: { amountRupees: 2500, mode: 'CARD' },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.invoice.status, 'PAID');
    const receipt = await call('GET', `/api/billing/receipts/${res.body.receipt.id}/pdf`, { token: admin });
    assert.equal(receipt.status, 200);
    assert.equal(receipt.raw.subarray(0, 5).toString('latin1'), '%PDF-');
  });

  it('saves the draft with a signature, finalises and serves the consent PDF while storage is unreachable', async () => {
    const s = await createStudent(admin);
    const enr = await enroll(admin, s.id, ref.hathaMonth.id, TODAY);
    const form = await call('POST', '/api/consent/forms', { token: admin, body: { studentId: s.id, enrollmentId: enr.body.enrollment.id, formDate: TODAY } });
    const id = form.body.form.id;

    const save = await call('PUT', `/api/consent/forms/${id}`, {
      token: admin,
      body: { consentSafetyAck: true, studioPoliciesAck: true, codeOfConductAck: true, finalAck: true, studentSignatureDataUrl: SIGNATURE_DATA_URL },
    });
    assert.equal(save.status, 200, JSON.stringify(save.body));

    const fin = await call('POST', `/api/consent/forms/${id}/finalize`, { token: admin });
    assert.equal(fin.status, 200, JSON.stringify(fin.body));
    assert.equal(fin.body.form.status, 'FINALIZED');
    assert.equal(fin.body.pdfUrl, null, 'archive copy could not be stored — reported honestly, not faked');

    const pdf = await call('GET', `/api/consent/forms/${id}/pdf`, { token: admin });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.raw.subarray(0, 5).toString('latin1'), '%PDF-');
  });

  it('reports a clear error for the signed-copy upload and leaves no orphan record', async () => {
    const s = await createStudent(admin);
    const form = await call('POST', '/api/consent/forms', { token: admin, body: { studentId: s.id, formDate: TODAY } });
    const fd = new FormData();
    fd.append('file', new Blob([PNG_1PX], { type: 'image/png' }), 'signed.png');
    const up = await call('POST', `/api/consent/forms/${form.body.form.id}/uploads`, { token: admin, form: fd });
    assert.equal(up.status, 503);
    assert.match(up.body.error, /File storage is unavailable.*not saved/);
    assert.equal(await prisma.consentUpload.count(), 0);
    assert.equal((await prisma.consentForm.findUniqueOrThrow({ where: { id: form.body.form.id } })).status, 'DRAFT');
  });
});

describe('TC-19 WhatsApp not configured', () => {
  it('reports "not configured" and never claims a reminder was sent', async () => {
    whatsappMock.reset();
    const s = await createStudent(admin);
    const enr = await enroll(admin, s.id, ref.hathaMonth.id, day(-27)); // ends in 3 days

    const status = await call('GET', '/api/automations/whatsapp-status', { token: admin });
    assert.equal(status.body.whatsapp.configured, false);

    const run = await call('POST', '/api/automations/run-reminders', { token: admin });
    assert.equal(run.body.summary.whatsappConfigured, false);
    assert.equal(run.body.summary.whatsappSent, 0);
    assert.equal(run.body.summary.whatsappNotConfigured, 1);
    assert.equal(run.body.summary.renewalNotifications, 1, 'the in-app renewal alert still works');
    assert.equal(whatsappMock.calls.length, 0);

    const log = await prisma.messageLog.findFirstOrThrow({ where: { enrollmentId: enr.body.enrollment.id } });
    assert.equal(log.status, 'NOT_CONFIGURED');
    assert.equal(log.sentAt, null);
    assert.match(log.error ?? '', /not configured/);

    const due = await call('GET', '/api/enrollments/renewals-due?days=7', { token: admin });
    assert.equal(due.body.config.whatsappConfigured, false);
    assert.equal(due.body.enrollments[0].lastReminder.status, 'NOT_CONFIGURED');
  });
});
