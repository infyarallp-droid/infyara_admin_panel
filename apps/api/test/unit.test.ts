// Pure-logic tests (no database): status rules, dates, CSV, PDF text safety.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  addDaysISO,
  computeEnrollmentStatus,
  computeStudentStatus,
  diffDaysISO,
  normalizeMobile,
  parseFlexibleDate,
  parseISODate,
  todayISO,
} from '@moksha/shared';
import { parseCsv, toCsv } from '../src/lib/csv.js';
import { pdfSafe } from '../src/lib/pdf/text.js';

const rules = { renewalWindowDays: 7, activeRequiresPayment: 'none' as const };
const status = (e: Partial<Parameters<typeof computeEnrollmentStatus>[0]>, today: string, r = rules) =>
  computeEnrollmentStatus({ status: 'ACTIVE', startDate: '2026-10-01', endDate: '2026-10-31', ...e }, today, r).status;

describe('enrolment status rules', () => {
  it('derives status from saved dates', () => {
    assert.equal(status({}, '2026-09-30'), 'UPCOMING');
    assert.equal(status({}, '2026-10-01'), 'ACTIVE', 'start date is inclusive');
    assert.equal(status({}, '2026-10-23'), 'ACTIVE');
    assert.equal(status({}, '2026-10-24'), 'RENEWAL_DUE', '7 days before the end');
    assert.equal(status({}, '2026-10-31'), 'RENEWAL_DUE', 'end date is inclusive');
    assert.equal(status({}, '2026-11-01'), 'EXPIRED');
  });

  it('keeps lifecycle flags above dates', () => {
    assert.equal(status({ status: 'CANCELLED' }, '2026-10-10'), 'CANCELLED');
    assert.equal(status({ status: 'COMPLETED' }, '2026-10-10'), 'RENEWED');
    // Renewed early: still in use until the renewal starts, then closed.
    assert.equal(status({ status: 'COMPLETED', renewalStartDate: '2026-11-01' }, '2026-10-10'), 'ACTIVE');
    assert.equal(status({ status: 'COMPLETED', renewalStartDate: '2026-10-10' }, '2026-10-10'), 'RENEWED');
    assert.equal(status({ status: 'COMPLETED', renewalStartDate: '2026-11-01' }, '2026-11-02'), 'RENEWED');
    assert.equal(status({ status: 'EXPIRED' }, '2026-10-10'), 'EXPIRED');
  });

  it('applies the payment rule only when the business turns it on', () => {
    const today = '2026-10-10';
    assert.equal(status({ paymentStatus: 'UNPAID' }, today), 'ACTIVE', 'default: payment does not gate Active');
    const full = { renewalWindowDays: 7, activeRequiresPayment: 'full' as const };
    assert.equal(status({ paymentStatus: 'UNPAID' }, today, full), 'PENDING_PAYMENT');
    assert.equal(status({ paymentStatus: 'PARTIAL' }, today, full), 'PENDING_PAYMENT');
    assert.equal(status({ paymentStatus: 'PAID' }, today, full), 'ACTIVE');
    const partial = { renewalWindowDays: 7, activeRequiresPayment: 'partial' as const };
    assert.equal(status({ paymentStatus: 'PARTIAL' }, today, partial), 'ACTIVE');
    assert.equal(status({ paymentStatus: 'UNPAID' }, today, partial), 'PENDING_PAYMENT');
    assert.equal(status({ paymentStatus: 'NONE' }, today, full), 'ACTIVE', 'no invoice → cannot be judged → not blocked');
    assert.equal(status({ paymentStatus: 'UNPAID' }, '2026-09-01', full), 'UPCOMING', 'a future start is Upcoming regardless of payment');
  });
});

describe('student status rules', () => {
  const end = '2026-10-31';
  it('one expired enrolment never deactivates a student with another valid one', () => {
    const r = computeStudentStatus({ status: 'ACTIVE' }, [{ status: 'EXPIRED', endDate: '2026-01-01' }, { status: 'ACTIVE', endDate: end }]);
    assert.equal(r.status, 'ACTIVE');
    assert.equal(r.manual, false);
  });
  it('is Inactive (with a reason and effective date) when every enrolment has ended', () => {
    const r = computeStudentStatus({ status: 'ACTIVE' }, [{ status: 'EXPIRED', endDate: '2026-01-01' }, { status: 'RENEWED', endDate: '2025-12-01' }]);
    assert.equal(r.status, 'INACTIVE');
    assert.equal(r.effectiveDate, '2026-01-01');
    assert.match(r.reason, /expired or cancelled/);
  });
  it('manual deactivation wins and carries its reason', () => {
    const r = computeStudentStatus(
      { status: 'INACTIVE', deactivationReason: 'Relocated', deactivationEffectiveDate: '2026-10-05' },
      [{ status: 'ACTIVE', endDate: end }],
    );
    assert.deepEqual(r, { status: 'INACTIVE', reason: 'Deactivated by admin: Relocated', manual: true, effectiveDate: '2026-10-05' });
  });
  it('distinguishes upcoming and never-enrolled students', () => {
    assert.equal(computeStudentStatus({ status: 'ACTIVE' }, [{ status: 'UPCOMING', endDate: end }]).status, 'UPCOMING');
    assert.equal(computeStudentStatus({ status: 'ACTIVE' }, []).status, 'NO_ENROLMENT');
  });
});

describe('dates and contact normalisation', () => {
  it('uses one business timezone for "today"', () => {
    // 2026-10-13 20:00 UTC is already 14 Oct in India.
    assert.equal(todayISO('Asia/Kolkata', new Date('2026-10-13T20:00:00Z')), '2026-10-14');
    assert.equal(todayISO('UTC', new Date('2026-10-13T20:00:00Z')), '2026-10-13');
  });
  it('does calendar maths without timezone drift', () => {
    assert.equal(addDaysISO('2026-10-09', 30), '2026-11-08');
    assert.equal(addDaysISO('2028-02-28', 1), '2028-02-29');
    assert.equal(diffDaysISO('2026-11-08', '2026-10-09'), 30);
    assert.equal(parseISODate('2026-02-30'), null);
  });
  it('parses legacy spreadsheet dates day-first and rejects ambiguity', () => {
    assert.equal(parseFlexibleDate('2026-10-09'), '2026-10-09');
    assert.equal(parseFlexibleDate('09-10-2026'), '2026-10-09');
    assert.equal(parseFlexibleDate('9/10/2026'), '2026-10-09');
    assert.equal(parseFlexibleDate('31-02-2026'), null);
    assert.equal(parseFlexibleDate('09-10-26'), null);
    assert.equal(parseFlexibleDate('October 9'), null);
  });
  it('normalises mobile numbers', () => {
    assert.equal(normalizeMobile('+91 98765-43210'), '9876543210');
    assert.equal(normalizeMobile('09876543210'), '9876543210');
    assert.equal(normalizeMobile('98765'), null);
    assert.equal(normalizeMobile('9.87654E+09'), null);
  });
});

describe('CSV', () => {
  it('round-trips quotes, commas, newlines and a BOM', () => {
    const rows = [['Name', 'Address'], ['A "B" C', '12, Temple Road\nNear Park']];
    assert.deepEqual(parseCsv(toCsv(rows)), rows);
    assert.deepEqual(parseCsv('a,b\r\n1,2'), [['a', 'b'], ['1', '2']]);
    assert.throws(() => parseCsv('a,"unterminated'), /not valid CSV/);
  });
});

describe('PDF text safety (root cause of the consent 500)', () => {
  it('makes any string drawable with the standard PDF font', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage();
    assert.throws(() => page.drawText('Fee: ₹2,300', { font }), /WinAnsi cannot encode/, 'the original failure');

    assert.equal(pdfSafe(font, 'Fee: ₹2,300'), 'Fee: Rs. 2,300');
    for (const text of ['₹2,300', 'రమ్య', 'José — “quoted” • bullet', '😀 tab\there\nnewline', '']) {
      assert.doesNotThrow(() => page.drawText(pdfSafe(font, text) || ' ', { font }));
    }
    assert.equal(pdfSafe(font, 'José'), 'José', 'encodable accents are preserved');
  });
});
