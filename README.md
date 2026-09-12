# Moksha Wellness — Admin Panel

Internal admin panel for Moksha Wellness (Yoga • Pilates • Dance): students, digital
consent forms, courses & teacher training, enrollments with class timings, renewals
(with auto WhatsApp reminders), invoices/payments/receipts, merchandise inventory,
employees, an omni-channel lead inbox (WhatsApp / Website / Google Form / LinkedIn),
in-app notifications, and an analytics dashboard.

> Full design & build plan: `C:\Users\msris\.claude\plans\im-the-team-lead-ethereal-oasis.md`

## Stack

- **Frontend:** React + Vite + TypeScript + Tailwind (`apps/web`)
- **Backend:** Node + Express + Prisma (`apps/api`)
- **Database:** PostgreSQL (Neon in prod) · **Cache/queues:** Redis (Upstash in prod)
- **Shared:** Zod schemas + types (`packages/shared`)
- **Hosting (free tier):** Vercel/Cloudflare Pages (web) · Render (API + cron) · Neon · Upstash · Supabase/R2 (files)

## Monorepo layout

```
apps/web/        React admin UI
apps/api/        Express + Prisma backend  (+ prisma/schema.prisma, prisma/seed.ts)
packages/shared/ Zod schemas + TS types shared FE↔BE
docker-compose.yml   local Postgres + Redis (dev only)
```

## Local setup

Prereqs: **Node 20+**, **pnpm 9+**, **Docker Desktop**.

```bash
# 1. Install deps
pnpm install

# 2. Env
cp .env.example .env
cp .env.example apps/api/.env
#   generate an ENCRYPTION_KEY (32-byte hex):
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
#   paste it into ENCRYPTION_KEY in apps/api/.env

# 3. Start local Postgres + Redis
pnpm db:up

# 4. Create the database schema + seed sample data
pnpm prisma:migrate      # creates all tables (first run: name it "init")
pnpm seed                # first admin + consent template + sample courses/products

# 5. Run web + api
pnpm dev
```

- Web: http://localhost:5173  ·  API health: http://localhost:4000/health
- Seeded admin: `admin@mokshawellness.in` / `ChangeMe@123` (change on first login)

## Useful scripts

| Command | What |
|---|---|
| `pnpm db:up` / `pnpm db:down` | Start/stop local Postgres+Redis |
| `pnpm prisma:migrate` | Create/apply a dev migration |
| `pnpm prisma:studio` | Browse the DB |
| `pnpm seed` | Seed sample data |
| `pnpm dev` | Run web + api together |
| `pnpm build` | Build both apps |

## Deployment (free tier)

See plan §3. In short: connect this GitHub repo to **Render** (root `apps/api`) and
**Vercel** (root `apps/web`); create **Neon** (Postgres), **Upstash** (Redis), and a
**Supabase/R2** bucket; set env vars per `.env.example`; run `prisma migrate deploy`.
Every `git push` redeploys.

## Integrations setup (M6)

All lead channels land in **Leads** with a source badge and raise an in-app notification.

**Website / Zapier / LinkedIn** — POST to the public endpoint with the API key (`PUBLIC_LEADS_API_KEY`):
```bash
curl -X POST https://<api>/api/public/leads \
  -H 'x-api-key: <PUBLIC_LEADS_API_KEY>' -H 'Content-Type: application/json' \
  -d '{"name":"Asha","phone":"9876500011","message":"Trial class?","source":"WEBSITE"}'
```
For LinkedIn Lead Gen Forms, bridge via Zapier/Make → this endpoint with `"source":"LINKEDIN"`.

**WhatsApp (Meta Cloud API)** — in Meta's app dashboard set the webhook callback to
`https://<api>/webhooks/whatsapp`, verify token = `WHATSAPP_VERIFY_TOKEN`, and set
`WHATSAPP_APP_SECRET` so inbound `X-Hub-Signature-256` is validated. Inbound messages create leads.

**Google Form** — add this Apps Script to the linked Sheet (Extensions → Apps Script), set an
`onFormSubmit` trigger:
```js
function onFormSubmit(e) {
  const answers = {};
  e.namedValues && Object.keys(e.namedValues).forEach(k => answers[k] = String(e.namedValues[k]));
  UrlFetchApp.fetch('https://<api>/webhooks/google-form', {
    method: 'post', contentType: 'application/json',
    headers: { 'x-shared-secret': '<GOOGLE_FORM_SHARED_SECRET>' },
    payload: JSON.stringify({ answers })
  });
}
```

## Build status

- [x] **M0 Foundation** — monorepo, full Prisma schema, dev Docker, env, health endpoint, seed
- [x] **M1 Students & Consent** — JWT auth + RBAC, student CRUD + search, consent template editor,
      digital consent form (health checklist, acknowledgements, signature pads), PDF generation/download,
      and signed-scan upload
- [x] **M2 Courses, Timings, Enrollments, Renewals** — course catalog (regular + 200/300/600 hr),
      plans, class timings, enroll-into-timing with computed end date, renewal flow, renewals-due list
- [x] **M3 Billing** — invoices (auto-raised on enroll/renew, FY numbering MW/2025-26/0001), line items,
      payments (multi-mode), auto-generated receipts, invoice + receipt PDFs, configurable tax %
- [x] **M4 Inventory** — products + variants (mat thickness / t-shirt size / drink flavour), stock ledger
      (restock + sale transactions), low-stock flags, and product sales that raise a PRODUCT invoice
- [x] **M5 Employees** — HR records with AES-256-GCM encrypted Aadhaar/PAN (masked by default, admin-only
      reveal), document uploads, and trainer↔timing links
- [x] **M6 Leads & Integrations** — unified lead inbox, in-app notification bell (30s poll),
      WhatsApp Cloud API webhook (verify + signature-checked inbound), public leads API
      (website/Zapier/LinkedIn), Google Form bridge, source tagging, convert-to-student
- [x] **M7 Automations** — daily reminders job (`node dist/jobs/reminders.js` via Render Cron):
      WhatsApp renewal template send + RENEWAL_DUE / LOW_STOCK notifications (deduped per day),
      PAYMENT_RECEIVED alerts, and an admin `POST /api/automations/run-reminders` trigger
- [x] **M8 Dashboard & Analytics** — `/api/analytics/summary` + Recharts dashboard (revenue, pending,
      active students, renewals due, leads-by-source pie, course-popularity bar, lead funnel, low stock)
- [x] **M9 Deploy prep** — Supabase storage provider, `deploy/render.yaml` (API + cron),
      `apps/web/vercel.json`, `deploy/google-apps-script.gs`, and **[DEPLOYMENT.md](DEPLOYMENT.md)**
      (click-by-click for Neon/Upstash/Supabase/Render/Vercel/WhatsApp). Git initialized; prod builds verified.
      _Remaining: you create the free accounts and follow DEPLOYMENT.md to go live._
