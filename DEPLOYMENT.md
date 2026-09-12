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

## Rollback / updates
`git push` redeploys Vercel + Render automatically. New migrations apply via the Render
`preDeployCommand`. To roll back, redeploy a previous commit from the Render/Vercel dashboards.
