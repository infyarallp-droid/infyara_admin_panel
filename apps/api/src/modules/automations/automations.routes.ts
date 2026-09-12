import { Router } from 'express';
import { asyncHandler } from '../../lib/http.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { runReminders } from '../../jobs/reminders.js';

export const automationsRouter = Router();
automationsRouter.use(requireAuth);

// Run the renewal + low-stock reminder pass on demand (the cron runs it daily).
automationsRouter.post(
  '/run-reminders',
  requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  asyncHandler(async (_req, res) => {
    const summary = await runReminders();
    res.json({ ok: true, summary });
  }),
);
