import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './lib/env.js';
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

const app = express();

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
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
// app.use('/api/public/leads', publicLeads);   // M6

app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`✅ Moksha API listening on ${env.API_PUBLIC_URL}`);
});
