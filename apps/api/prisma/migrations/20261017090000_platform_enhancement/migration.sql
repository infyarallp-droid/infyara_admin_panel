-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AuthMethod" AS ENUM ('MOBILE_PASSWORD', 'GOOGLE');

-- CreateEnum
CREATE TYPE "PublishStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('IMAGE', 'VIDEO');

-- CreateEnum
CREATE TYPE "VideoSource" AS ENUM ('NONE', 'YOUTUBE', 'VIMEO', 'UPLOAD');

-- CreateEnum
CREATE TYPE "ConsentState" AS ENUM ('OPTED_IN', 'OPTED_OUT');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('CREATED', 'ATTEMPTED', 'PAID', 'FAILED', 'EXPIRED', 'NEEDS_REVIEW');

-- AlterTable
ALTER TABLE "course_plans" ADD COLUMN     "is_online_purchasable" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "display_order" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "image_url" TEXT,
ADD COLUMN     "is_published" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "public_for_whom" TEXT,
ADD COLUMN     "public_summary" TEXT,
ADD COLUMN     "slug" TEXT;

-- AlterTable
ALTER TABLE "employee_documents" ADD COLUMN     "file_key" TEXT,
ADD COLUMN     "mime_type" TEXT;

-- AlterTable
ALTER TABLE "message_logs" ADD COLUMN     "campaign_id" UUID,
ADD COLUMN     "rule_id" UUID,
ADD COLUMN     "scheduled_for" TIMESTAMP(3),
ADD COLUMN     "template_id" UUID;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "refunded_paise" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "webhook_events" ADD COLUMN     "external_event_id" TEXT;

-- CreateTable
CREATE TABLE "customer_accounts" (
    "id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "email" TEXT,
    "password_hash" TEXT,
    "signup_method" "AuthMethod" NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "student_id" UUID,
    "linked_at" TIMESTAMP(3),
    "linked_by" UUID,
    "last_login_at" TIMESTAMP(3),
    "login_count" INTEGER NOT NULL DEFAULT 0,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_identities" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "provider" "AuthMethod" NOT NULL,
    "subject" TEXT NOT NULL,
    "email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_sessions" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_agent" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_login_events" (
    "id" UUID NOT NULL,
    "account_id" UUID,
    "mobile" TEXT,
    "method" "AuthMethod" NOT NULL,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_login_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "rotated_at" TIMESTAMP(3),
    "user_agent" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "original_name" TEXT,
    "alt" TEXT,
    "uploaded_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_blocks" (
    "key" TEXT NOT NULL,
    "draft" JSONB NOT NULL,
    "published" JSONB,
    "published_at" TIMESTAMP(3),
    "updated_by" UUID,
    "published_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_blocks_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "team_members" (
    "id" UUID NOT NULL,
    "employee_id" UUID,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "short_bio" TEXT NOT NULL,
    "bio" TEXT,
    "photo_url" TEXT,
    "specialization" TEXT,
    "experience" TEXT,
    "qualifications" TEXT,
    "social_links" JSONB,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "testimonials" (
    "id" UUID NOT NULL,
    "student_id" UUID,
    "student_name" TEXT NOT NULL,
    "photo_url" TEXT,
    "video_source" "VideoSource" NOT NULL DEFAULT 'NONE',
    "video_url" TEXT,
    "poster_url" TEXT,
    "quote" TEXT NOT NULL,
    "course_name" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "consent_name" BOOLEAN NOT NULL DEFAULT false,
    "consent_photo" BOOLEAN NOT NULL DEFAULT false,
    "consent_video" BOOLEAN NOT NULL DEFAULT false,
    "consent_recorded_at" TIMESTAMP(3),
    "consent_recorded_by" UUID,
    "consent_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "testimonials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faqs" (
    "id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "page" TEXT NOT NULL DEFAULT 'HOME',
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "message" TEXT NOT NULL,
    "link_label" TEXT,
    "link_url" TEXT,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gallery_items" (
    "id" UUID NOT NULL,
    "kind" "MediaKind" NOT NULL DEFAULT 'IMAGE',
    "url" TEXT NOT NULL,
    "poster_url" TEXT,
    "caption" TEXT,
    "alt" TEXT,
    "album" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gallery_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_consents" (
    "id" UUID NOT NULL,
    "mobile" TEXT NOT NULL,
    "state" "ConsentState" NOT NULL,
    "source" TEXT NOT NULL,
    "consent_text" TEXT,
    "student_id" UUID,
    "account_id" UUID,
    "recorded_by" UUID,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_templates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "body_text" TEXT,
    "variable_count" INTEGER NOT NULL DEFAULT 0,
    "meta_id" TEXT,
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_rules" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "offset_days" INTEGER NOT NULL DEFAULT 0,
    "template_id" UUID NOT NULL,
    "params" JSONB NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminder_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_campaigns" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "template_id" UUID NOT NULL,
    "params" JSONB NOT NULL,
    "recipient_ids" JSONB NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "recipient_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_orders" (
    "id" UUID NOT NULL,
    "gateway" TEXT NOT NULL DEFAULT 'RAZORPAY',
    "gateway_order_id" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "invoice_id" UUID,
    "course_plan_id" UUID,
    "plan_start_date" DATE,
    "amount_paise" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "description" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'CREATED',
    "payment_id" UUID,
    "enrollment_id" UUID,
    "failure_reason" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gateway_payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "gateway_payment_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "method" TEXT,
    "amount_paise" BIGINT NOT NULL,
    "fee_paise" BIGINT,
    "tax_paise" BIGINT,
    "refunded_paise" BIGINT NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "error_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gateway_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "gateway_payment_id" UUID NOT NULL,
    "gateway_refund_id" TEXT,
    "amount_paise" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "initiated_by" UUID,
    "applied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_markers" (
    "key" TEXT NOT NULL,
    "value" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_markers_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_accounts_mobile_key" ON "customer_accounts"("mobile");

-- CreateIndex
CREATE UNIQUE INDEX "customer_accounts_student_id_key" ON "customer_accounts"("student_id");

-- CreateIndex
CREATE INDEX "customer_accounts_created_at_idx" ON "customer_accounts"("created_at");

-- CreateIndex
CREATE INDEX "customer_accounts_last_login_at_idx" ON "customer_accounts"("last_login_at");

-- CreateIndex
CREATE INDEX "auth_identities_account_id_idx" ON "auth_identities"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_identities_provider_subject_key" ON "auth_identities"("provider", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "customer_sessions_token_hash_key" ON "customer_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "customer_sessions_account_id_idx" ON "customer_sessions"("account_id");

-- CreateIndex
CREATE INDEX "customer_login_events_account_id_created_at_idx" ON "customer_login_events"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "customer_login_events_created_at_idx" ON "customer_login_events"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "staff_sessions_token_hash_key" ON "staff_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "staff_sessions_user_id_idx" ON "staff_sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_storage_key_key" ON "media_assets"("storage_key");

-- CreateIndex
CREATE INDEX "media_assets_kind_created_at_idx" ON "media_assets"("kind", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "team_members_employee_id_key" ON "team_members"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_members_slug_key" ON "team_members"("slug");

-- CreateIndex
CREATE INDEX "team_members_status_display_order_idx" ON "team_members"("status", "display_order");

-- CreateIndex
CREATE INDEX "testimonials_status_display_order_idx" ON "testimonials"("status", "display_order");

-- CreateIndex
CREATE INDEX "faqs_page_status_display_order_idx" ON "faqs"("page", "status", "display_order");

-- CreateIndex
CREATE INDEX "announcements_status_idx" ON "announcements"("status");

-- CreateIndex
CREATE INDEX "gallery_items_status_display_order_idx" ON "gallery_items"("status", "display_order");

-- CreateIndex
CREATE INDEX "whatsapp_consents_mobile_created_at_idx" ON "whatsapp_consents"("mobile", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_templates_name_language_key" ON "whatsapp_templates"("name", "language");

-- CreateIndex
CREATE INDEX "reminder_rules_trigger_is_enabled_idx" ON "reminder_rules"("trigger", "is_enabled");

-- CreateIndex
CREATE INDEX "message_campaigns_status_scheduled_at_idx" ON "message_campaigns"("status", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_orders_gateway_order_id_key" ON "payment_orders"("gateway_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_orders_payment_id_key" ON "payment_orders"("payment_id");

-- CreateIndex
CREATE INDEX "payment_orders_account_id_created_at_idx" ON "payment_orders"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "payment_orders_status_updated_at_idx" ON "payment_orders"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "gateway_payments_gateway_payment_id_key" ON "gateway_payments"("gateway_payment_id");

-- CreateIndex
CREATE INDEX "gateway_payments_order_id_idx" ON "gateway_payments"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_gateway_refund_id_key" ON "refunds"("gateway_refund_id");

-- CreateIndex
CREATE INDEX "refunds_gateway_payment_id_idx" ON "refunds"("gateway_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "courses_slug_key" ON "courses"("slug");

-- CreateIndex
CREATE INDEX "message_logs_status_scheduled_for_idx" ON "message_logs"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "message_logs_campaign_id_idx" ON "message_logs"("campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_external_event_id_key" ON "webhook_events"("external_event_id");

-- AddForeignKey
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_login_events" ADD CONSTRAINT "customer_login_events_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_rules" ADD CONSTRAINT "reminder_rules_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "whatsapp_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_campaigns" ADD CONSTRAINT "message_campaigns_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "whatsapp_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "customer_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateway_payments" ADD CONSTRAINT "gateway_payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "payment_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_gateway_payment_id_fkey" FOREIGN KEY ("gateway_payment_id") REFERENCES "gateway_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

