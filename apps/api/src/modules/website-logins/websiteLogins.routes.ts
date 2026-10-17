import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, HttpError } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import { temporaryPassword } from '../../lib/tokens.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { consentMap } from '../messaging/consent.service.js';

// Admin: everyone who has signed up / signed in on the website.
export const websiteLoginsRouter = Router();
websiteLoginsRouter.use(requireAuth);

const view = requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'FRONT_DESK');
const manage = requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER');

const idParam = (v: string) => {
  const p = z.string().uuid().safeParse(v);
  if (!p.success) throw new HttpError(404, 'Account not found');
  return p.data;
};

const accountSelect = {
  id: true,
  fullName: true,
  mobile: true,
  email: true,
  signupMethod: true,
  status: true,
  studentId: true,
  linkedAt: true,
  lastLoginAt: true,
  loginCount: true,
  mustChangePassword: true,
  createdAt: true,
  passwordHash: true,
  student: { select: { id: true, fullName: true, studentCode: true, mobile: true } },
  identities: { select: { provider: true, email: true, createdAt: true } },
} satisfies Prisma.CustomerAccountSelect;

type Row = Prisma.CustomerAccountGetPayload<{ select: typeof accountSelect }>;
const present = ({ passwordHash, ...a }: Row) => ({ ...a, hasPassword: !!passwordHash });

// GET /api/website-logins?q=&linked=&method=&status=&page=
websiteLoginsRouter.get(
  '/',
  view,
  asyncHandler(async (req, res) => {
    const q = z
      .object({
        q: z.string().trim().max(100).optional(),
        linked: z.enum(['yes', 'no']).optional(),
        method: z.enum(['MOBILE_PASSWORD', 'GOOGLE']).optional(),
        status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25),
      })
      .parse(req.query);
    const where: Prisma.CustomerAccountWhereInput = {
      signupMethod: q.method,
      status: q.status,
      ...(q.linked === 'yes' ? { studentId: { not: null } } : q.linked === 'no' ? { studentId: null } : {}),
      ...(q.q
        ? {
            OR: [
              { fullName: { contains: q.q, mode: 'insensitive' } },
              { mobile: { contains: q.q.replace(/\D/g, '') || q.q } },
              { email: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const since = new Date(Date.now() - 7 * 86_400_000);
    const [total, rows, totals] = await Promise.all([
      prisma.customerAccount.count({ where }),
      prisma.customerAccount.findMany({
        where,
        select: accountSelect,
        orderBy: [{ lastLoginAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      Promise.all([
        prisma.customerAccount.count(),
        prisma.customerAccount.count({ where: { studentId: null } }),
        prisma.customerAccount.count({ where: { createdAt: { gte: since } } }),
        prisma.customerLoginEvent.count({ where: { success: true, createdAt: { gte: since } } }),
      ]),
    ]);

    // Unlinked accounts whose mobile matches a studio record: likely the same person (staff confirm).
    const unlinkedMobiles = rows.filter((r) => !r.studentId).map((r) => r.mobile);
    const matches = unlinkedMobiles.length
      ? await prisma.student.findMany({ where: { mobile: { in: unlinkedMobiles }, account: null }, select: { id: true, fullName: true, studentCode: true, mobile: true } })
      : [];
    const consents = await consentMap(rows.map((r) => r.mobile));

    res.json({
      ok: true,
      total,
      page: q.page,
      pageSize: q.pageSize,
      stats: { accounts: totals[0], unlinked: totals[1], newThisWeek: totals[2], signInsThisWeek: totals[3] },
      accounts: rows.map((r) => ({
        ...present(r),
        suggestedStudent: matches.find((m) => m.mobile === r.mobile) ?? null,
        whatsapp: consents.get(r.mobile) ?? null,
      })),
    });
  }),
);

// GET /api/website-logins/activity — recent sign-ins and failed attempts across all accounts.
websiteLoginsRouter.get(
  '/activity',
  view,
  asyncHandler(async (req, res) => {
    const { limit, failedOnly } = z
      .object({ limit: z.coerce.number().int().min(1).max(200).default(50), failedOnly: z.enum(['true', 'false']).optional() })
      .parse(req.query);
    const events = await prisma.customerLoginEvent.findMany({
      where: failedOnly === 'true' ? { success: false } : {},
      include: { account: { select: { id: true, fullName: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    res.json({ ok: true, events });
  }),
);

websiteLoginsRouter.get(
  '/:id',
  view,
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const account = await prisma.customerAccount.findUnique({ where: { id }, select: accountSelect });
    if (!account) throw new HttpError(404, 'Account not found');
    const [events, sessions, orders, consents, suggested] = await Promise.all([
      prisma.customerLoginEvent.findMany({ where: { accountId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.customerSession.findMany({
        where: { accountId: id, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true, createdAt: true, lastSeenAt: true, userAgent: true, ip: true },
        orderBy: { lastSeenAt: 'desc' },
      }),
      prisma.paymentOrder.findMany({ where: { accountId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
      prisma.whatsAppConsent.findMany({ where: { mobile: account.mobile }, orderBy: { createdAt: 'desc' }, take: 20 }),
      account.studentId ? null : prisma.student.findFirst({ where: { mobile: account.mobile, account: null }, select: { id: true, fullName: true, studentCode: true, mobile: true } }),
    ]);
    res.json({ ok: true, account: present(account), events, sessions, orders, consents, suggestedStudent: suggested });
  }),
);

// POST /api/website-logins/:id/link { studentId } — confirm this login belongs to that studio student.
websiteLoginsRouter.post(
  '/:id/link',
  manage,
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const { studentId } = z.object({ studentId: z.string().uuid() }).parse(req.body);
    await prisma.$transaction(async (tx) => {
      const student = await tx.student.findUnique({ where: { id: studentId }, include: { account: { select: { id: true, fullName: true } } } });
      if (!student) throw new HttpError(404, 'Student not found');
      if (student.account && student.account.id !== id) {
        throw new HttpError(409, `That student is already linked to the website login of ${student.account.fullName}`);
      }
      await tx.customerAccount.update({ where: { id }, data: { studentId, linkedAt: new Date(), linkedById: req.user!.sub } });
      await audit(tx, { userId: req.user!.sub, action: 'ACCOUNT_LINKED', entity: 'customer_account', entityId: id, meta: { studentId } });
    });
    const account = await prisma.customerAccount.findUniqueOrThrow({ where: { id }, select: accountSelect });
    res.json({ ok: true, account: present(account) });
  }),
);

websiteLoginsRouter.post(
  '/:id/unlink',
  manage,
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    await prisma.$transaction(async (tx) => {
      const before = await tx.customerAccount.findUniqueOrThrow({ where: { id } });
      await tx.customerAccount.update({ where: { id }, data: { studentId: null, linkedAt: null, linkedById: null } });
      await audit(tx, { userId: req.user!.sub, action: 'ACCOUNT_UNLINKED', entity: 'customer_account', entityId: id, meta: { studentId: before.studentId } });
    });
    res.json({ ok: true });
  }),
);

// POST /api/website-logins/:id/status { status, reason } — suspend (signs out everywhere) or reactivate.
websiteLoginsRouter.post(
  '/:id/status',
  manage,
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const { status, reason } = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']), reason: z.string().trim().max(300).optional() }).parse(req.body);
    await prisma.$transaction(async (tx) => {
      await tx.customerAccount.update({ where: { id }, data: { status } });
      if (status === 'SUSPENDED') {
        await tx.customerSession.updateMany({ where: { accountId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await audit(tx, { userId: req.user!.sub, action: status === 'SUSPENDED' ? 'ACCOUNT_SUSPENDED' : 'ACCOUNT_REACTIVATED', entity: 'customer_account', entityId: id, meta: { reason: reason ?? null } });
    });
    res.json({ ok: true });
  }),
);

// POST /api/website-logins/:id/reset-password — issue a temporary password (shown once) and sign out everywhere.
websiteLoginsRouter.post(
  '/:id/reset-password',
  manage,
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const temp = temporaryPassword();
    await prisma.$transaction(async (tx) => {
      await tx.customerAccount.update({ where: { id }, data: { passwordHash: await bcrypt.hash(temp, 12), mustChangePassword: true } });
      await tx.customerSession.updateMany({ where: { accountId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await audit(tx, { userId: req.user!.sub, action: 'ACCOUNT_PASSWORD_RESET', entity: 'customer_account', entityId: id });
    });
    res.json({ ok: true, temporaryPassword: temp });
  }),
);

websiteLoginsRouter.post(
  '/:id/revoke-sessions',
  manage,
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const { count } = await prisma.customerSession.updateMany({ where: { accountId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(prisma, { userId: req.user!.sub, action: 'ACCOUNT_SESSIONS_REVOKED', entity: 'customer_account', entityId: id, meta: { count } });
    res.json({ ok: true, revoked: count });
  }),
);
