import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { prisma } from './lib/prisma.js';
import { errorHandler } from './lib/http.js';
import { uploadDir } from './lib/storage.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { studentsRouter } from './modules/students/students.routes.js';
import { consentRouter } from './modules/consent/consent.routes.js';
import { coursesRouter } from './modules/courses/courses.routes.js';
import { enrollmentsRouter } from './modules/enrollments/enrollments.routes.js';
import { billingRouter } from './modules/billing/billing.routes.js';
import { inventoryRouter } from './modules/inventory/inventory.routes.js';
import { employeesRouter } from './modules/employees/employees.routes.js';
import { leadsRouter } from './modules/leads/leads.routes.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
import { automationsRouter } from './modules/automations/automations.routes.js';
import { analyticsRouter } from './modules/analytics/analytics.routes.js';
import { publicLeadsRouter } from './webhooks/publicLeads.js';
import { googleFormRouter } from './webhooks/googleForm.js';
import { whatsappRouter } from './webhooks/whatsapp.js';
import { razorpayRouter } from './webhooks/razorpay.js';
import { customerAuthRouter } from './modules/customer-auth/customerAuth.routes.js';
import { accountRouter } from './modules/account/account.routes.js';
import { websiteLoginsRouter } from './modules/website-logins/websiteLogins.routes.js';
import { cmsRouter } from './modules/cms/cms.routes.js';
import { publicContentRouter } from './modules/cms/public.routes.js';
import { chatbotRouter } from './modules/chatbot/chatbot.routes.js';
import { whatsappAdminRouter } from './modules/whatsapp/whatsapp.routes.js';
import { paymentsRouter } from './modules/payments/payments.routes.js';
import { jobsRouter, systemRouter } from './modules/system/system.routes.js';
import { webOrigins } from './lib/env.js';

// The Express app, without the listener — imported by index.ts and by the tests.
export const app = express();

// Render / Vercel sit behind one proxy hop; needed for correct client IPs.
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
// Only the admin panel's origin(s) may call the API from a browser. The website calls server-to-server.
app.use(cors({ origin: webOrigins.length === 1 ? webOrigins[0] : webOrigins, credentials: true }));
// Capture the raw body so WhatsApp's X-Hub-Signature-256 can be verified.
app.use(
  express.json({
    limit: '5mb',
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);

// Serve locally-stored files in dev (prod uses Supabase/R2 signed URLs)
app.use('/uploads', express.static(uploadDir));

// Health check (uptime pinger + Render)
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, service: 'moksha-api', db: 'up', time: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ ok: false, db: 'down', error: (err as Error).message });
  }
});

// ── Route modules ──
app.use('/api/auth', authRouter);
app.use('/api/students', studentsRouter);
app.use('/api/consent', consentRouter);
app.use('/api/courses', coursesRouter);
app.use('/api/enrollments', enrollmentsRouter);
app.use('/api/billing', billingRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/employees', employeesRouter);
app.use('/api/leads', leadsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/automations', automationsRouter);
app.use('/api/analytics', analyticsRouter);
// Public intake + webhooks (no JWT; secured by API key / verify token / signature)
app.use('/api/public/leads', publicLeadsRouter);
app.use('/webhooks/google-form', googleFormRouter);
app.use('/webhooks/whatsapp', whatsappRouter);
app.use('/webhooks/razorpay', razorpayRouter);

// Website accounts (called by the website's server with the service key)
app.use('/api/customer-auth', customerAuthRouter);
app.use('/api/account', accountRouter);
// Public website content (read-only)
app.use('/api/public/chat', chatbotRouter);
app.use('/api/public', publicContentRouter);
// Admin modules
app.use('/api/website-logins', websiteLoginsRouter);
app.use('/api/cms', cmsRouter);
app.use('/api/whatsapp', whatsappAdminRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/system', systemRouter);
// Scheduler entry point (CRON_SECRET)
app.use('/internal/jobs', jobsRouter);

app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }));
app.use(errorHandler);
