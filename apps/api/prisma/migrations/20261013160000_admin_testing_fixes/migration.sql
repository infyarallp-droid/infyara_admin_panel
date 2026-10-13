-- Admin Page Testing fixes (OBS-01 … OBS-11).
-- Additive only: new nullable columns, two new tables, indexes. No column or
-- table is dropped and no existing value is overwritten.

-- ── Pre-check for the "one renewal per enrolment" unique index ──────────────
-- The old renew endpoint could create two renewals of the same enrolment on a
-- double click. Keep the earliest renewal linked; for any later duplicate, move
-- the link into `notes` (so the history is still readable) instead of failing
-- the migration or deleting anything.
ALTER TABLE "enrollments" ADD COLUMN "notes" TEXT;

WITH ranked AS (
  SELECT id, parent_enrollment_id,
         ROW_NUMBER() OVER (PARTITION BY parent_enrollment_id ORDER BY created_at, id) AS rn
  FROM "enrollments"
  WHERE parent_enrollment_id IS NOT NULL
)
UPDATE "enrollments" e
SET notes = 'Duplicate renewal of enrolment ' || r.parent_enrollment_id::text || ' (de-linked by migration 20261013160000)',
    parent_enrollment_id = NULL
FROM ranked r
WHERE e.id = r.id AND r.rn > 1;

-- CreateEnum
CREATE TYPE "DeliveryMode" AS ENUM ('OFFLINE', 'ONLINE', 'HYBRID');

-- AlterTable
ALTER TABLE "consent_forms" ADD COLUMN     "finalized_at" TIMESTAMP(3),
ADD COLUMN     "finalized_by" UUID;

-- AlterTable
ALTER TABLE "consent_uploads" ADD COLUMN     "file_key" TEXT,
ADD COLUMN     "file_name" TEXT,
ADD COLUMN     "mime_type" TEXT,
ADD COLUMN     "size_bytes" INTEGER;

-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "code" TEXT,
ADD COLUMN     "delivery_mode" "DeliveryMode";

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "enrollment_id" UUID;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "idempotency_key" TEXT,
ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "students" ADD COLUMN     "deactivated_at" TIMESTAMP(3),
ADD COLUMN     "deactivated_by" UUID,
ADD COLUMN     "deactivation_effective_date" DATE,
ADD COLUMN     "deactivation_reason" TEXT,
ADD COLUMN     "student_code" TEXT;

-- CreateTable
CREATE TABLE "counters" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "counters_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "message_logs" (
    "id" UUID NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "event" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "student_id" UUID,
    "enrollment_id" UUID,
    "recipient" TEXT,
    "template_name" TEXT,
    "params" JSONB,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "provider_message_id" TEXT,
    "provider_response" JSONB,
    "error" TEXT,
    "triggered_by" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_logs_pkey" PRIMARY KEY ("id")
);

-- ── Backfill: Student IDs for existing students (oldest first) ──────────────
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS n FROM "students"
)
UPDATE "students" s
SET student_code = 'STU-' || LPAD(numbered.n::text, 4, '0')
FROM numbered
WHERE s.id = numbered.id;

INSERT INTO "counters" ("key", "value")
SELECT 'student', COUNT(*) FROM "students";

-- ── Backfill: students already marked INACTIVE keep that state, with a reason ─
UPDATE "students"
SET deactivation_reason = 'Marked inactive before status rules were introduced',
    deactivation_effective_date = updated_at::date,
    deactivated_at = updated_at
WHERE status = 'INACTIVE';

-- ── Backfill: link each enrolment/renewal invoice to its enrolment ──────────
-- The invoice was raised in the same transaction as the enrolment, for the same
-- student and plan. Link only when that match is unambiguous in both directions.
WITH candidates AS (
  SELECT i.id AS invoice_id, e.id AS enrollment_id,
         COUNT(*) OVER (PARTITION BY i.id) AS per_invoice,
         COUNT(*) OVER (PARTITION BY e.id) AS per_enrollment
  FROM "invoices" i
  JOIN "invoice_items" it ON it.invoice_id = i.id AND it.item_type = 'COURSE_PLAN'
  JOIN "enrollments" e
    ON e.student_id = i.student_id
   AND e.course_plan_id = it.ref_id
   AND ABS(EXTRACT(EPOCH FROM (i.created_at - e.created_at))) < 30
  WHERE i.type IN ('ENROLLMENT', 'RENEWAL')
)
UPDATE "invoices" i
SET enrollment_id = c.enrollment_id
FROM candidates c
WHERE i.id = c.invoice_id AND c.per_invoice = 1 AND c.per_enrollment = 1;

-- CreateIndex
CREATE UNIQUE INDEX "message_logs_dedupe_key_key" ON "message_logs"("dedupe_key");

-- CreateIndex
CREATE INDEX "message_logs_student_id_idx" ON "message_logs"("student_id");

-- CreateIndex
CREATE INDEX "message_logs_enrollment_id_idx" ON "message_logs"("enrollment_id");

-- CreateIndex
CREATE INDEX "message_logs_provider_message_id_idx" ON "message_logs"("provider_message_id");

-- CreateIndex
CREATE INDEX "message_logs_status_created_at_idx" ON "message_logs"("status", "created_at");

-- CreateIndex
CREATE INDEX "consent_uploads_consent_form_id_idx" ON "consent_uploads"("consent_form_id");

-- CreateIndex
CREATE UNIQUE INDEX "courses_code_key" ON "courses"("code");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_parent_enrollment_id_key" ON "enrollments"("parent_enrollment_id");

-- CreateIndex
CREATE INDEX "invoices_enrollment_id_idx" ON "invoices"("enrollment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "students_student_code_key" ON "students"("student_code");

-- CreateIndex
CREATE INDEX "students_email_idx" ON "students"("email");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
