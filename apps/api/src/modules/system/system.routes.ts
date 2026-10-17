import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../lib/env.js';
import { asyncHandler, HttpError } from '../../lib/http.js';
import { safeEqual } from '../../lib/tokens.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { runTick } from '../../jobs/tick.js';

// POST /internal/jobs/tick — the scheduler's entry point (secret-protected, no user login).
export const jobsRouter = Router();
jobsRouter.post(
  '/tick',
  asyncHandler(async (req, res) => {
    if (!env.CRON_SECRET) throw new HttpError(503, 'CRON_SECRET is not set on the API');
    const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
    const provided = (req.headers['x-cron-secret'] as string | undefined) ?? bearer;
    if (!safeEqual(provided, env.CRON_SECRET)) throw new HttpError(401, 'Invalid cron secret');
    res.json({ ok: true, result: await runTick() });
  }),
);

// Admin: audit log viewer + job runner health.
export const systemRouter = Router();
systemRouter.use(requireAuth, requireRole('SUPER_ADMIN', 'ADMIN'));

systemRouter.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const q = z
      .object({
        entity: z.string().max(60).optional(),
        action: z.string().max(60).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(req.query);
    const where: Prisma.AuditLogWhereInput = {
      entity: q.entity,
      ...(q.action ? { action: { contains: q.action.toUpperCase() } } : {}),
    };
    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        include: { user: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    res.json({ ok: true, total, page: q.page, pageSize: q.pageSize, logs });
  }),
);

systemRouter.get(
  '/jobs',
  asyncHandler(async (_req, res) => {
    const markers = await prisma.jobMarker.findMany();
    res.json({
      ok: true,
      cronSecretSet: !!env.CRON_SECRET,
      internalSchedulerSeconds: env.INTERNAL_SCHEDULER_SECONDS,
      tickUrl: `${env.API_PUBLIC_URL.replace(/\/+$/, '')}/internal/jobs/tick`,
      markers,
    });
  }),
);

systemRouter.post(
  '/jobs/run',
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, result: await runTick() });
  }),
);
