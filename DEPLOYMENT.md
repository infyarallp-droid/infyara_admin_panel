# Moksha Wellness — Deployment Guide

Deploy the whole app on free tiers: **Neon** (Postgres) · **Upstash** (Redis) ·
**Supabase** (file storage) · **Render** (API + daily cron) · **Vercel** (frontend).
Everything is connected from the GitHub repo — no servers to manage. Budget for one paid
thing only if you want it: Render's ~₹600/mo always-on API (the free API sleeps when idle).

> Do these in order. Copy each secret into a scratch note as you go — you'll paste them into Render/Vercel.

---

## 0. Push to GitHub
```bash
git init && git add -A && git commit -m "Moksha admin panel"
git branch -M main
git remote add origin https://github.com/<you>/moksha-wellness-admin-panel.git
git push -u origin main
```

## 1. Neon — PostgreSQL (free)
1. neon.tech → new project (region near you).
2. Copy the **pooled** connection string → this is `DATABASE_URL`
   (looks like `postgresql://user:pass@ep-xxx-pooler.../neondb?sslmode=require`).
3. Nothing else — the first deploy runs migrations automatically.

## 2. Upstash — Redis (free)
1. upstash.com → create a Redis database.
2. Copy the **TLS** URL (`rediss://…`) → `REDIS_URL`.

## 3. Supabase — file storage (free)
1. supabase.com → new project.
2. Storage → create a **private** bucket named `moksha-uploads`.
3. Project Settings → API → copy **Project URL** (`SUPABASE_URL`) and the
   **service_role** key (`SUPABASE_SERVICE_KEY`) — keep the service key secret (server-only).

## 4. Generate app secrets
```bash
# ENCRYPTION_KEY (32-byte hex — REQUIRED, used for Aadhaar/PAN encryption)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Render generates `JWT_SECRET`, `JWT_REFRESH_SECRET`, `PUBLIC_LEADS_API_KEY`,
`GOOGLE_FORM_SHARED_SECRET` for you (see blueprint). Keep the last two — you'll need them
for the website form and Google Form.

## 5. Render — API + Cron (free)
1. render.com → **New → Blueprint** → connect the repo. It reads `deploy/render.yaml`
   and creates **moksha-api** (web) + **moksha-reminders** (daily cron).
2. Fill the `sync:false` env vars on **both** services: `DATABASE_URL`, `REDIS_URL`,
   `ENCRYPTION_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`. On the web service also set
   `API_PUBLIC_URL` (your Render URL, e.g. `https://moksha-api.onrender.com`) and
   `WEB_ORIGIN` (your Vercel URL — fill after step 6, then redeploy).
3. Deploy. The `preDeployCommand` runs `prisma migrate deploy` (creates all tables).
4. **Seed the first admin** — Render web service → Shell:
   ```bash
   pnpm --filter @moksha/api seed
   ```
   Login later with `admin@mokshawellness.in` / `ChangeMe@123` → change it immediately.
5. Health check: open `https://moksha-api.onrender.com/health` → `{"ok":true,...}`.

## 6. Vercel — frontend (free)
1. vercel.com → New Project → import the repo.
2. **Root Directory** → `apps/web`. Framework auto-detects Vite (`apps/web/vercel.json`
   adds the SPA rewrite).
3. Env var: `VITE_API_URL` = your Render API URL (`https://moksha-api.onrender.com`).
4. Deploy → you get `https://<project>.vercel.app`.
5. Go back to Render → set the web service's `WEB_ORIGIN` to this Vercel URL → redeploy
   (CORS). Open the Vercel URL and log in. ✅

_(Optional domain: add `admin.mokshawellness.in` in Vercel and `api.mokshawellness.in` in
Render, then update `VITE_API_URL` + `WEB_ORIGIN` to match. SSL is automatic on both.)_

## 7. WhatsApp — Meta Cloud API
> Start early: Facebook Business verification + template approval take days.
1. Meta Business (business.facebook.com) → verify your business.
2. developers.facebook.com → create an app → add **WhatsApp** → note the **Phone number ID**
   (`WHATSAPP_PHONE_NUMBER_ID`) and generate a **permanent access token** via a System User
   (`WHATSAPP_ACCESS_TOKEN`). App Settings → copy **App Secret** (`WHATSAPP_APP_SECRET`).
3. WhatsApp → Configuration → **Webhook**:
   - Callback URL: `https://moksha-api.onrender.com/webhooks/whatsapp`
   - Verify token: any string — set the SAME value as `WHATSAPP_VERIFY_TOKEN` on Render.
   - Subscribe to the **messages** field.
4. Create + submit a **message template** named `renewal_reminder` (category: Utility) with a
   body using 3 variables, e.g.
   `Hi {{1}}, your Moksha course {{2}} ends on {{3}}. Reply to renew.`
   Set `WHATSAPP_RENEWAL_TEMPLATE` to the approved template name.
5. Put all four WhatsApp values into Render (web + cron) → redeploy. Inbound messages now
   create leads; the daily cron sends renewal reminders.

## 8. Google Form
1. Open the form's linked Sheet → Extensions → Apps Script → paste `deploy/google-apps-script.gs`.
2. Set `API_BASE` (Render URL) and `SHARED_SECRET` (= `GOOGLE_FORM_SHARED_SECRET` from Render).
3. Add an **On form submit** trigger for `onFormSubmit`. Submit a test → a lead appears in the panel.

## 9. Website & LinkedIn
- **Website form:** POST to `https://moksha-api.onrender.com/api/public/leads` with header
  `x-api-key: <PUBLIC_LEADS_API_KEY>` and JSON `{ name, phone, message, source: "WEBSITE" }`.
- **LinkedIn Lead Gen:** connect LinkedIn → **Zapier/Make** → POST to the same endpoint with
  `source: "LINKEDIN"`. (Native LinkedIn API needs Marketing Developer Platform approval; the
  Zapier bridge works day one.)

---

## Post-deploy checklist
- [ ] `/health` returns ok; login works on the Vercel URL.
- [ ] Change the seeded admin password; add real staff users/roles.
- [ ] Create a course + plan + timing; enroll a test student → invoice + receipt PDFs open.
- [ ] Add products/variants; run a test sale.
- [ ] Website `curl`, Google Form submit, WhatsApp message → each appears in Leads with its source.
- [ ] Trigger `POST /api/automations/run-reminders` (or wait for the cron) → renewal WhatsApp + bell.
- [ ] Turn on Render always-on (or a free uptime pinger) if cold starts bother you.
- [ ] Set up nightly backups (Neon PITR / a scheduled `pg_dump`).

## Release: Admin Page Testing fixes (migration `20261013160000_admin_testing_fixes`)

**Before deploying**
1. Take a database backup / note the Neon restore point.
2. The migration is additive only (new nullable columns, tables `counters` and `message_logs`, indexes).
   It backfills Student IDs (`STU-0001…`), links existing enrolment invoices to their enrolment, and — if the
   old double-click bug ever created two renewals of one enrolment — keeps the first linked and records the
   link of the extra one in its `notes` (nothing is deleted).

**What the deploy does** (Render `buildCommand`): `prisma migrate deploy` → `catalog:sync` → build.
`catalog:sync` creates the requested courses if missing (matched by code, then name) and never creates
plans or fees. It is safe to re-run: `pnpm --filter @moksha/api catalog:sync`.

**After deploying**
- [ ] Courses → for each new course set **plan, duration, fee**, delivery mode and timetable (they show a
      "to be confirmed" notice and cannot take enrolments until a plan exists).
- [ ] Check Supabase storage: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` set and the private bucket
      `moksha-uploads` exists. Payments and consent finalisation no longer depend on it, but signed-copy
      uploads do (they now fail with a clear "File storage is unavailable" message instead of a 500).
- [ ] Record one test payment and finalise one test consent form.
- [ ] WhatsApp: set the credentials (section 7) and get the templates approved; until then the Renewals
      page shows "WhatsApp is not set up" and nothing is sent. Subscribe the webhook to **messages** (this
      also delivers sent/delivered/read receipts into the message log).
- [ ] Optional business rules are env vars — see the "Business rules" block in `.env.example`.

**Tests** (local only — they need the Docker Postgres and use a separate `<db>_test` database):
`pnpm --filter @moksha/api test`

## Release: website accounts, CMS, WhatsApp module, Razorpay (migration `20261017090000_platform_enhancement`)

This release connects the public website (repo `mokshawellness_website`, hosted on Vercel) to this
API. Do the steps in order. Nothing here deletes or rewrites existing data.

### What the migration does
Additive only: new tables (website accounts, sessions, login events, staff sessions, CMS content,
team, testimonials, FAQs, announcements, gallery, media, WhatsApp consent/templates/rules/campaigns,
payment orders, gateway payments, refunds, job markers) and new **nullable/defaulted** columns on
`courses`, `course_plans`, `payments`, `employee_documents`, `message_logs`, `webhook_events`.
`cms:seed` then fills the website text of the 10 catalogue courses (only where empty) and imports the
5 original FAQs if there are none. Both are safe to re-run.

### Before deploying
1. **Back up**: Neon → *Branches* → create a branch named `before-platform-2026-10` (instant copy), or note the restore point.
2. **Supabase public bucket** for website media: Storage → **New bucket** → name `moksha-public` → **Public bucket: ON** → file size limit `50 MB` → allowed MIME types `image/jpeg, image/png, image/webp, image/gif, image/avif, video/mp4, video/webm, video/quicktime`. (Keep the existing private `moksha-uploads` bucket for consent/HR files.)
3. Generate the shared secrets (run 3 times):
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` →
   `WEBSITE_SERVICE_KEY`, `WEBSITE_REVALIDATE_SECRET`, and (optional, Render can generate it) `CRON_SECRET`.

### API (Render → moksha-api → Environment)
| Variable | Value |
|---|---|
| `WEBSITE_SERVICE_KEY` | secret #1 (same value on the website) |
| `WEBSITE_URL` | `https://www.mokshawellness.in` |
| `WEBSITE_REVALIDATE_SECRET` | secret #2 (same value as `REVALIDATE_SECRET` on the website) |
| `SUPABASE_PUBLIC_BUCKET` | `moksha-public` |
| `CRON_SECRET` | secret #3 |
| `GOOGLE_CLIENT_ID` | see docs/SETUP_GOOGLE_AUTH.md (optional) |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | see docs/SETUP_RAZORPAY.md (test keys first) |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` (+ existing WhatsApp vars) | see docs/SETUP_WHATSAPP.md |
| `WEB_ORIGIN` | admin panel URL(s), comma-separated |

The build command in `deploy/render.yaml` now also runs `cms:seed` — update the service's
*Build Command* if it was created before this release (Render → Settings → Build & Deploy).

In production the API **refuses to start** with sample secrets, the all-zero `ENCRYPTION_KEY`,
`STORAGE_PROVIDER=local`, WhatsApp without `WHATSAPP_APP_SECRET`, or Razorpay without
`RAZORPAY_WEBHOOK_SECRET`. The Render log names exactly what is missing.

### Website (Vercel → website project → Settings → Environment Variables)
| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://www.mokshawellness.in` |
| `ADMIN_API_URL` | the API URL, e.g. `https://api.mokshawellness.in` |
| `PUBLIC_LEADS_API_KEY` | unchanged |
| `WEBSITE_SERVICE_KEY` | secret #1 |
| `REVALIDATE_SECRET` | secret #2 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | optional, docs/SETUP_GOOGLE_AUTH.md |

### Job runner (scheduled WhatsApp, automatic reminders, daily renewal check, payment recovery)
The API exposes `POST /internal/jobs/tick` (header `x-cron-secret: <CRON_SECRET>`). It is safe to
call as often as you like. Pick **one** scheduler:

- **Free — cron-job.org**: create a cron job → URL `https://<api>/internal/jobs/tick` → every **5 minutes** → *Advanced*: request method **POST**, header `x-cron-secret` = `CRON_SECRET`, timeout 60 s. On Render's free tier this also keeps the API awake (one service fits in the free 750 instance-hours/month).
- **Render Cron (paid, ~US$1+/month)**: uncomment the `moksha-jobs` service in `deploy/render.yaml`.
- **Always-on paid instance**: set `INTERNAL_SCHEDULER_SECONDS=60` (an external scheduler is still a good backup).

Admin → **Audit Log & Jobs** shows when it last ran. The old daily `node dist/jobs/reminders.js`
cron is no longer needed (the tick runs it once per day); running both is harmless.

**Recommendation:** once students sign in and pay online, move the API to Render **Starter** (~US$7/month): no 30–60 s cold start on the first sign-in after a quiet spell.

### Deploy order
1. Push/merge the admin panel branch → Render builds (migrate → catalog:sync → cms:seed → build) and Vercel rebuilds the admin web.
2. Check `https://<api>/health` → `{"ok":true}`; Render logs show no config errors.
3. Push/merge the website branch → Vercel builds it.
4. **Staff must sign in again once** (staff refresh tokens are now opaque and revocable; old ones are no longer accepted).

### Verify in production
- [ ] Website pages load; the new logo shows in header, footer and the browser tab.
- [ ] Admin → *Page Content* → change a word in *Home — hero* → **Publish** → refresh the website: the change is there within seconds. Change it back.
- [ ] Create an account on the website → it appears in admin → *Website Logins* → link it to a test student.
- [ ] Admin → *Team* → add a member with a photo → visible on `/team` (photo loads from Supabase).
- [ ] Publish the three policy pages (after review) → footer links appear.
- [ ] Razorpay test payment end to end (docs/SETUP_RAZORPAY.md §6).
- [ ] WhatsApp test send to your own number (docs/SETUP_WHATSAPP.md §9).
- [ ] *Audit Log & Jobs* → "Last run" updates every ~5 minutes.

### Rolling back
- **Code**: redeploy the previous commit from the Render and Vercel dashboards. The database changes are additive, so the previous code runs unchanged against the new schema (it ignores the new tables/columns).
- **Database**: not needed for a code rollback. If you must restore data, use the Neon branch created before deploying. Do **not** drop the new tables by hand.
- **Website only**: Vercel → Deployments → previous deployment → *Promote to production*.

## Local development (all three apps)

```bash
# 1. Database + Redis (Docker Desktop running)
pnpm db:up
# 2. Admin repo: env (copy .env.example → .env and fill in), schema, seed
pnpm install
pnpm prisma:deploy && pnpm seed && pnpm --filter @moksha/api catalog:sync && pnpm --filter @moksha/api cms:seed
pnpm dev                       # API :4000 + admin web :5173
# 3. Website repo (separate terminal): .env.local with ADMIN_API_URL=http://localhost:4000 and the
#    same WEBSITE_SERVICE_KEY / REVALIDATE_SECRET as the API's .env
pnpm install && pnpm dev       # website :3000
```
Use `STORAGE_PROVIDER=local` locally (files go to `apps/api/uploads/`, git-ignored). Restart the
API after changing `.env` (tsx watch does not reload environment files).

Tests: `pnpm --filter @moksha/api test` (99 API tests, uses a separate `<db>_test` database and a
separate Redis database; WhatsApp, Google and Razorpay are local mocks). Browser journeys live in the
website repo: see its `docs/TESTING.md`.

## Rollback / updates
`git push` redeploys Vercel + Render automatically. New migrations apply via the Render
`preDeployCommand`. To roll back, redeploy a previous commit from the Render/Vercel dashboards.
