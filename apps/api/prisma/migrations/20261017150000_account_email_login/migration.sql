-- Website accounts can sign in with email (mobile number stays mandatory).

-- AlterEnum
ALTER TYPE "AuthMethod" ADD VALUE 'EMAIL_PASSWORD';

-- Normalise existing emails before making them unique (no-op on an empty table).
UPDATE "customer_accounts" SET "email" = NULL WHERE "email" IS NOT NULL AND btrim("email") = '';
UPDATE "customer_accounts" SET "email" = lower(btrim("email")) WHERE "email" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "customer_accounts_email_key" ON "customer_accounts"("email");
