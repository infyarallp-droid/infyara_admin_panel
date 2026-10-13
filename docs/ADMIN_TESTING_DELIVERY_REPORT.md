# Admin Page Testing — Delivery Report

Source documents: `Admin Page Testing.docx`, `Admin_Page_Testing_Observations_and_Logic.docx`.
Date: 2026-10-13. Environment used for all testing: local Docker Postgres/Redis only.

**Nothing has been committed, pushed or deployed.** Production (Render/Vercel/Neon) was not touched.

Status categories: **COMPLETED AND VERIFIED** · **IMPLEMENTED BUT NOT FULLY VERIFIED** ·
**BLOCKED — EXTERNAL ACTION REQUIRED** · **NOT COMPLETED**.

---

## 1. Requirement checklist

| ID | Observation | Status | Where it lives | Verified by |
|---|---|---|---|---|
| OBS-01 | Add the course / class catalogue | COMPLETED AND VERIFIED | `apps/api/prisma/catalog.ts`, `courses.routes.ts`, `Courses.tsx`, `EnrollDrawer.tsx` | TC-01 |
| OBS-02 | Old-student upload template + validated bulk import | COMPLETED AND VERIFIED | `students.import.service.ts`, `students.import.routes.ts`, `lib/csv.ts`, `ImportStudentsDrawer.tsx` | TC-11, TC-12 |
| OBS-03 | Active / Inactive status logic, reason and effective date | COMPLETED AND VERIFIED (rules awaiting business sign-off, §6) | `packages/shared/src/index.ts` (status rules), `students.routes.ts`, `enrollments.service.ts` | TC-06…TC-09 |
| OBS-04 | Joining date in Students list and Renewals Due | COMPLETED AND VERIFIED | `students.routes.ts`, `enrollments.routes.ts`, `Students.tsx`, `Renewals.tsx` | TC-05 |
| OBS-05 | Multiple courses for one student, no duplicate master | COMPLETED AND VERIFIED | `students.routes.ts` (`/match`, 409 with existing record), `enrollments.routes.ts` | TC-02, TC-03, TC-04 |
| OBS-06 | Consent form finalise / download / print PDF | COMPLETED AND VERIFIED (print dialog itself not exercised headlessly) | `consent.routes.ts`, `lib/pdf/consentPdf.ts`, `lib/pdf/text.ts`, `ConsentForm.tsx` | TC-13, TC-14 |
| OBS-07 | Renewal start date, next-expiry calculation | COMPLETED AND VERIFIED (default convention awaiting sign-off) | `enrollments.routes.ts` (`/renew`), `RenewDialog.tsx` | TC-10 |
| OBS-08 | Student and renewal payments, receipts, balance | COMPLETED AND VERIFIED | `billing.service.ts`, `billing.routes.ts`, `InvoiceDetail.tsx` | TC-15…TC-18 |
| OBS-09 | WhatsApp reminders / notifications | IMPLEMENTED — real sending BLOCKED on credentials + approved templates | `lib/whatsappSend.ts`, `modules/messaging/messaging.service.ts`, `jobs/reminders.ts`, `automations.routes.ts`, `webhooks/whatsapp.ts` | TC-19 (mock provider) |
| OBS-10 | "Internal server error" on consent finalise and payment | COMPLETED AND VERIFIED locally; production retest BLOCKED until deployed | see §3 | TC-20, `outage.test.ts` |
| OBS-11 | Renewal list: student, course, joining/start, expiry, days left, action | COMPLETED AND VERIFIED | `Renewals.tsx`, `enrollments.routes.ts` (`/renewals-due`) | TC-05, TC-10 |

## 2. What changed

**Database** — one additive migration, `apps/api/prisma/migrations/20261013160000_admin_testing_fixes`
(rehearsed on a scratch database shaped like legacy data before being applied locally):

- `students`: `student_code` (unique Student ID, backfilled `STU-0001…` oldest first), `deactivation_reason`,
  `deactivation_effective_date`, `deactivated_at`, `deactivated_by`; index on `email`.
- `courses`: `code` (unique), `delivery_mode` (`OFFLINE | ONLINE | HYBRID`, nullable = to be confirmed).
- `enrollments`: `notes`; **unique** `parent_enrollment_id` (a period can be renewed once — retries cannot duplicate).
  Pre-existing duplicate renewals, if any, are de-linked into `notes`, never deleted.
- `invoices`: `enrollment_id` (FK; backfilled only where the match is unambiguous).
- `payments`: `idempotency_key` (unique), `notes`.
- `consent_forms`: `finalized_at`, `finalized_by`. `consent_uploads`: `file_key`, `file_name`, `mime_type`, `size_bytes`.
- New tables: `counters` (atomic invoice / receipt / student numbering), `message_logs` (WhatsApp audit log).
- No column or table dropped; no existing value overwritten.

**Backend (new)** `src/app.ts`, `lib/{audit,counters,csv,dates}.ts`, `lib/pdf/text.ts`,
`modules/enrollments/enrollments.service.ts`, `modules/messaging/messaging.service.ts`,
`modules/students/students.import.{service,routes}.ts`, `prisma/catalog.ts`, `test/*`.
**Backend (modified)** `index.ts`, `lib/{env,http,storage,whatsappSend}.ts`, `lib/pdf/{consentPdf,invoicePdf}.ts`,
`jobs/reminders.ts`, routes for analytics, automations, billing (+service), consent, courses, enrollments,
leads, students, `webhooks/whatsapp.ts`, `prisma/{schema.prisma,seed.ts}`, `package.json`.

**Frontend (new)** `components/{ImportStudentsDrawer,RenewDialog}.tsx`, `lib/{format,useSingleFlight}.ts`.
**Frontend (modified)** `lib/api.ts`, `components/EnrollDrawer.tsx`, pages `Students`, `StudentProfile`,
`Renewals`, `InvoiceDetail`, `ConsentForm`, `Courses`.

**Shared** `packages/shared/src/index.ts` — date helpers and the status rules (one implementation for API and UI).

**Tooling / docs** `.eslintrc.cjs` + ESLint dev dependencies (the `lint` script existed but ESLint was never
installed), `deploy/render.yaml` (runs `catalog:sync` after migrations), `.env.example`, `DEPLOYMENT.md`.
`README.md` was left as found (it already had uncommitted edits and an encoding problem at the end).

## 3. Root causes of the two "Internal server error"s

**Consent finalise — proven.** `Error: WinAnsi cannot encode "₹" (0x20b9)` at `consentPdf.ts`. The built-in
PDF font cannot encode the rupee sign, and a consent form created from an enrolment prints `Fee: ₹…`.
Every such form failed; forms without an enrolment succeeded. Reproduced on the unmodified code with the
stack trace. Fix: all PDF text is passed through `pdfSafe()` (₹ → `Rs.`, unencodable characters replaced),
and the form only becomes FINALIZED after the PDF has been generated, so a failure leaves the draft intact.

Three further defects in the same flow, also fixed: the signature was never drawn on the PDF (it was stored
as a URL but the generator only handled data URLs); signatures were drawn on a stale page when the content
overflowed; and saving a draft with a signature uploaded to file storage first, so a storage problem also
produced a 500.

**Payment recording — mechanism proven, production trigger not confirmed.** The receipt PDF was uploaded
to file storage *inside the payment database transaction*. Any storage failure threw a plain error → 500
and rolled the payment back. Reproduced on the unmodified code by making storage unreachable
(`Supabase upload failed`, 0 payments left behind). With working storage the same request succeeded
locally, so the production trigger is a storage problem on the deployed API (missing bucket, wrong key, or
the upload outlasting the 5-second transaction limit). **I had no access to the Render logs, so I could not
confirm which.** The fix removes the dependency either way: the payment transaction is now database-only
and receipts are generated on demand.

Related payment defects fixed: overpayment and repeat payment on a paid invoice were accepted; invoice and
receipt numbers were issued by `count()+1` (collisions under concurrency); "Invoice not found" returned 500;
the invoice "Download PDF" link returned 401 because a plain link cannot carry the login token.

## 4. Business rules as implemented

Each is enforced on the server. Items marked ⚙ are settings (`.env.example` → "Business rules"), so a
business decision does not need a code change.

- **Student master** — one record per person; mobile is unique. A known mobile is refused with the existing
  record returned; a known email asks for confirmation that it is a different person.
- **Duplicate enrolment** — same student + same course + overlapping dates is blocked (any plan). A later,
  non-overlapping period is allowed. ⚙ `DUPLICATE_ENROLLMENT_OVERRIDE` (default off) lets SUPER_ADMIN/ADMIN
  override with a reason, written to the audit log. Concurrent submissions are serialised per student.
- **Enrolment status** (calculated, never typed): Upcoming (before start) → Active → Renewal due (within the
  largest reminder window, ⚙ `RENEWAL_REMINDER_DAYS`, default 7) → Expired (after the end date). A period
  that has been renewed shows Renewed once its renewal has started. Start and end dates are inclusive.
- **Payment and Active** — ⚙ `ACTIVE_REQUIRES_PAYMENT=none` (default: the behaviour the app has always had —
  payment does not gate Active). `partial` / `full` show "Pending payment" until satisfied. A fully
  discounted (complimentary) enrolment owes nothing and counts as paid.
- **Student status** — Inactive only when an admin deactivates the student (reason required, date not in the
  future, user and time recorded, audit trail kept) or when every enrolment has expired/cancelled. One
  expired enrolment never deactivates a student with another valid one. A deactivated student cannot be
  enrolled or renewed until reactivated.
- **Dates** — one timezone, ⚙ `BUSINESS_TIMEZONE=Asia/Kolkata`. End date = start + plan length in days
  (unchanged convention: 1 month = 30 days).
- **Renewal** — the admin always sees and confirms the renewal start date; next expiry is calculated from it
  and shown before saving. ⚙ `RENEWAL_START_DEFAULT=TODAY` (existing behaviour) or `DAY_AFTER_EXPIRY` only
  changes what is pre-filled. The original period and joining date are preserved; each renewal is its own
  record with its own invoice.
- **Payments** — amount > 0, at most 2 decimals, not more than the outstanding balance (advance payments not
  supported), date not in the future, modes CASH / UPI / CARD / BANK_TRANSFER / OTHER. Partial payments
  allowed. Every submission carries an idempotency key; a retry returns the original payment.
- **Legacy import** — invalid rows are never imported; existing students are never overwritten
  (optional "fill blank fields only"); a row is imported fully or not at all; re-uploading a file imports
  nothing twice.
- **WhatsApp** — one renewal reminder per enrolment per reminder window; never sent to an invalid number;
  never reported as sent when not configured.

## 5. Test results

Automated: `pnpm --filter @moksha/api test` → **62 tests, 62 passed** (API → validation → PostgreSQL test
database; only the WhatsApp provider is mocked). Real-browser walk-through of the UI (headless Chrome
against the local stack): **35 of 35 checks passed**, no 5xx responses, no browser errors.
`pnpm typecheck` pass · `pnpm lint` 0 errors (1 warning in untouched `ConsentTemplates.tsx`) ·
`pnpm build` pass (API + web). All test data is synthetic (made-up `9000…` mobiles, `example.com` emails).

| ID | Scenario | Expected | Actual | Result |
|---|---|---|---|---|
| TC-01 | Course catalogue | Each course once, right category and mode | 10 courses, once each after 3 sync runs; Mat Pilates is one programme (Offline & Online); visible on Courses and in the enrol form; no fee invented | PASS |
| TC-02 | Existing student match | Found, no duplicate master | Matched on `+91 …` mobile and on email (case-insensitive); duplicate refused with the existing record; UI offers "Use & enrol" | PASS |
| TC-03 | Multiple courses | Two enrolments under one student | Two enrolments, two invoices, one student | PASS |
| TC-04 | Duplicate enrolment | Warned or blocked | Blocked (409, names the clashing period); 5 simultaneous submits → 1 enrolment; later period allowed | PASS |
| TC-05 | Joining date display | Visible and correct in both lists | Students list and Renewals Due both show it; values match the stored start date | PASS |
| TC-06 | Future start | Upcoming, not Active | `UPCOMING`, reason "Starts on …" | PASS |
| TC-07 | Active | Active | `ACTIVE`, 25 days remaining | PASS |
| TC-08 | Expired | Expired, shown in renewal view | `EXPIRED`; listed in Renewals Due; student shows Inactive with reason | PASS |
| TC-09 | Mixed statuses | Student not deactivated | Student `ACTIVE`; expired enrolment stays `EXPIRED` | PASS |
| TC-10 | Renewal calculation | Start and next expiry correct | Start day+3 → expiry day+33; previous expiry returned; original joining date preserved; second attempt 409; 4 simultaneous clicks → 1 renewal | PASS |
| TC-11 | Bulk upload, valid | Rows import, counts accurate | 3 rows → 2 students, 3 enrolments, 2 payments; re-upload → 0 imported, 3 skipped | PASS |
| TC-12 | Bulk upload, invalid | Row-level reasons, no corruption | 11 invalid rows each with its reason, 1 duplicate; only the 2 valid rows imported; `.xlsx`, unknown and missing columns refused | PASS |
| TC-13 | Consent PDF | Generated, matches student/course | Draft → save → finalise → PDF opens; valid 2-page PDF titled for the student; finalised once under 3 concurrent calls; non-Latin names do not fail | PASS (the browser print dialog was not exercised in headless mode) |
| TC-14 | Signed consent upload | Saved and linked | Stored against the right form, byte-identical on download, staff-only; wrong file type refused | PASS |
| TC-15 | Payment recording | Paid, balance, status, history update | Invoice PAID, receipt issued, receipt and invoice PDFs open; renewal invoice payable separately | PASS |
| TC-16 | Partial payment | Balance correct | ₹1,000.50 then ₹1,499.50 → PARTIAL then PAID; paid = sum of payments | PASS |
| TC-17 | Invalid payment | Rejected with clear message | 0, negative, text, missing, 3 decimals, over balance, bad mode, future date all refused; nothing recorded | PASS |
| TC-18 | Duplicate submit | One transaction | Retry returns the original; 6 simultaneous same-key requests → 1 payment; triple-click in the UI → 1 payment | PASS |
| TC-19 | WhatsApp reminder | Logged, not duplicated | Mock provider: 1 send to `91…`, logged SENT with provider id, repeat run sends nothing; failure retried; rate limit stops the run; delivery receipt updates the log | PASS with mock · **real send BLOCKED** (no credentials / approved templates) |
| TC-20 | Error handling | Completes or clear error, no partial records | With storage unreachable: payment succeeds, consent finalises, signed-copy upload fails with a clear 503 and no orphan row; bad ids → 400/404 | PASS locally · **production retest BLOCKED** until deployed |

Defects found while testing, and fixed: (1) a UI triple-click sent three requests — the server recorded one
payment but the screen showed the "already recorded" notice; added a synchronous single-flight guard;
(2) a student who renewed ahead of time showed "Upcoming" while the original period was still running;
(3) two validation patterns were mangled by a scripted edit (caught by the seed run); (4) `pnpm seed` did
not load the root `.env` and could not be run twice; (5) ESLint was not installed.

**Incident during testing (local only).** My first test run used the local *dev* database instead of the
test database because of an import-ordering flaw in my test bootstrap, and its reset step emptied it. At the
start of the session that database held one seeded admin user and no students, enrolments, invoices,
payments, courses or consent forms; I had not looked at leads, employees or inventory. It has been re-seeded.
The bootstrap now loads the app only after the environment is switched, and refuses to run unless the live
connection is the `_test` database (verified with a deliberately mis-ordered run).

## 6. Decisions that need business approval

| Decision | What the app does today |
|---|---|
| Is payment required before Active? Partial / complimentary handling | Not required (existing behaviour). Setting available: `ACTIVE_REQUIRES_PAYMENT` |
| Renewal start convention | Admin picks the date; pre-filled with today. Setting: `RENEWAL_START_DEFAULT` |
| Renewal reminder windows | 7, 3 and 1 days before expiry (`RENEWAL_REMINDER_DAYS`) |
| WhatsApp message templates and triggering events | Renewal reminder only. Payment and admission messages are built but off until a template name is set |
| Required fields for legacy import | Full Name + Mobile; enrolment needs Course, Joining Date, Plan |
| Legacy payments | Recorded as payment mode OTHER, reference `LEGACY-IMPORT`, **no new receipt number issued** |
| Legacy periods that ended more than 30 days ago | Stored as historical (Expired), kept out of Renewals Due and reminders |
| Fees, durations, timetables, delivery mode of new courses | Not set. Courses show "to be confirmed" and cannot take enrolments until a plan is added |
| "Mat Pilates Level 1 TT" vs "Mat Pilates TT – Offline & Online" | Treated as one programme with mode Offline & Online (as in the Observations document) |
| "Aerial Yoga Training" category | Listed under Teacher Training (the Observations document calls it "Training") |
| Existing "Yoga Teacher Training (TTC)" course with 200/300/600-hour plans | Left untouched; overlaps the new 200-Hour / 300-Hour courses — retire it or keep it |
| Duplicate-enrolment override | Off. Setting: `DUPLICATE_ENROLLMENT_OVERRIDE` |
| Does deactivation block new enrolments? | Yes, until reactivated |
| Consent signature process | Finalise needs all four acknowledgements plus either an on-screen signature or an uploaded signed copy. Guardian signature for minors is shown but not enforced. Wording is unchanged (comes from the consent template) |
| Advance / excess payments, cancellations, refunds | Excess payments refused. The application has no cancel or refund feature; none was added |

## 7. External setup still required

- **WhatsApp** (Render web + cron): `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`,
  `WHATSAPP_VERIFY_TOKEN`; Meta-approved template `renewal_reminder` with body variables name / course /
  expiry date; webhook subscribed to *messages*. All four credential values are empty locally.
- **File storage**: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` and the private bucket `moksha-uploads` — check
  these on Render; they are the most likely cause of the production payment error.
- **Render logs** for the original 500s, if confirmation of the production trigger is wanted.

## 8. Deployment

Not deployed. Steps are in `DEPLOYMENT.md` → "Release: Admin Page Testing fixes". In short: back up the
database, commit and push (Render runs `prisma migrate deploy`, then `catalog:sync`, then the build; Vercel
rebuilds the web app), then add plans/fees to the new courses and record one test payment and one test
consent form.

## 9. Manual verification (after deploy, with a test student)

1. Courses — the ten courses appear under Teacher Training / Regular Classes with their mode.
2. Students → New Student → type an existing mobile → the existing student is offered; "Use & enrol".
3. Enrol the same student in two courses; try the first course again → blocked with a message.
4. Students list — Student ID, Joining date, courses, status with reason.
5. Student profile → "+ Consent" on an enrolment → tick sections 2–5, sign, **Finalize & Download PDF** → PDF opens.
   Upload a signed copy; open it again from the list.
6. Open the invoice → pay part, then the balance → PARTIAL then PAID; open the receipt and the invoice PDF.
7. Renewals Due → Renew → choose a start date → next expiry shown → confirm.
8. Students → Import old students → download the template, upload it with one good and one bad row.

## 10. Remaining risks and limitations

- The import accepts CSV only (opens and saves from Excel); `.xlsx` is refused with instructions.
- PDF text uses the standard font: names in Indian scripts print as `?`. Proper support needs an embedded
  Unicode font.
- New signatures are stored with the consent row in the database (small PNGs) rather than in file storage.
- The older public `/uploads` route is unchanged, so files previously stored on local disk remain reachable
  by URL. New signed copies are served only through an authenticated route.
- An in-app "renewal due" alert is still raised daily for an expired, un-renewed enrolment (existing behaviour).
- The tests need the local Docker Postgres; there is no CI.
- Production behaviour (Neon, Supabase, Render) is unverified until the release is deployed and re-tested.
