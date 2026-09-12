import { Router } from 'express';
import type { UserRole } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

// Which role-targeted broadcasts each viewer role can see (admins oversee all).
const VISIBLE_TARGETS: Record<UserRole, UserRole[]> = {
  SUPER_ADMIN: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'FRONT_DESK', 'ACCOUNTANT', 'TRAINER'],
  ADMIN: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'FRONT_DESK', 'ACCOUNTANT', 'TRAINER'],
  MANAGER: ['MANAGER', 'FRONT_DESK', 'ACCOUNTANT', 'TRAINER'],
  FRONT_DESK: ['FRONT_DESK'],
  ACCOUNTANT: ['ACCOUNTANT'],
  TRAINER: ['TRAINER'],
};

// Notifications addressed to this user directly OR broadcast to a role they see.
function scope(req: Parameters<typeof requireAuth>[0]) {
  return { OR: [{ userId: req.user!.sub }, { roleTarget: { in: VISIBLE_TARGETS[req.user!.role] } }] };
}

// GET /api/notifications  → recent list + unread count (bell polls this ~30s)
notificationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const where = scope(req);
    const [items, unread] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: 30 }),
      prisma.notification.count({ where: { ...where, isRead: false } }),
    ]);
    res.json({ ok: true, unread, items });
  }),
);

notificationsRouter.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    await prisma.notification.update({ where: { id: req.params.id }, data: { isRead: true } });
    res.json({ ok: true });
  }),
);

notificationsRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    await prisma.notification.updateMany({ where: { ...scope(req), isRead: false }, data: { isRead: true } });
    res.json({ ok: true });
  }),
);
