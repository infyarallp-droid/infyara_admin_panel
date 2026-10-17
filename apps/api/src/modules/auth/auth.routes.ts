import { Router, type Request } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { loginSchema } from '@moksha/shared';
import type { User } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../lib/env.js';
import { asyncHandler, HttpError } from '../../lib/http.js';
import { signAccessToken } from '../../lib/jwt.js';
import { clientIp, hit, limitByIp, reset } from '../../lib/rateLimit.js';
import { hashToken, newToken } from '../../lib/tokens.js';
import { requireAuth } from '../../middleware/auth.js';

export const authRouter = Router();

const LOGIN_WINDOW_MS = 15 * 60_000;
const MAX_FAILURES_PER_EMAIL = 8;
/** A rotated refresh token presented again within this window is a benign race (two tabs), not theft. */
const ROTATION_GRACE_MS = 60_000;
/** Compared against when the account does not exist, so response time does not reveal valid emails. */
export const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-password', 10);

/** "7d", "12h", "30m" → milliseconds (the JWT_REFRESH_TTL format). */
function ttlMs(ttl: string): number {
  const m = /^(\d+)\s*([smhd])$/.exec(ttl.trim());
  if (!m) return 7 * 86_400_000;
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 's' | 'm' | 'h' | 'd'];
  return Number(m[1]) * unit;
}

/** Issue an access JWT (15 min) + a new opaque, revocable refresh token. */
async function issueTokens(user: Pick<User, 'id' | 'role' | 'name'>, req: Request) {
  const refreshToken = newToken();
  await prisma.staffSession.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + ttlMs(env.JWT_REFRESH_TTL)),
      userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
      ip: clientIp(req),
    },
  });
  return { accessToken: signAccessToken({ sub: user.id, role: user.role, name: user.name }), refreshToken };
}

authRouter.post(
  '/login',
  limitByIp('staff-login', 30, LOGIN_WINDOW_MS),
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const key = `staff-login:email:${email.toLowerCase()}`;
    const failures = await hit(key, LOGIN_WINDOW_MS);
    if (failures > MAX_FAILURES_PER_EMAIL) {
      throw new HttpError(429, 'Too many sign-in attempts for this account. Please wait 15 minutes and try again.');
    }

    const user = await prisma.user.findUnique({ where: { email } });
    // Compare against a dummy hash when the user does not exist, so timing does not reveal valid emails.
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !user.isActive || !ok) throw new HttpError(401, 'Invalid credentials');
    await reset(key);

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const tokens = await issueTokens(user, req);
    res.json({
      ok: true,
      ...tokens,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  }),
);

authRouter.post(
  '/refresh',
  limitByIp('staff-refresh', 120, LOGIN_WINDOW_MS),
  asyncHandler(async (req, res) => {
    const { refreshToken } = z.object({ refreshToken: z.string().min(10).max(500) }).parse(req.body);
    const session = await prisma.staffSession.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new HttpError(401, 'Invalid refresh token');
    }
    if (session.rotatedAt) {
      // Already exchanged. Shortly after rotation it is a race between tabs; later it means the old
      // token was copied, so every session of this user is revoked.
      if (Date.now() - session.rotatedAt.getTime() > ROTATION_GRACE_MS) {
        await prisma.staffSession.updateMany({ where: { userId: session.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      throw new HttpError(401, 'Invalid refresh token');
    }
    // Deactivated users lose access at their next refresh, and role changes take effect then too.
    if (!session.user.isActive) {
      await prisma.staffSession.updateMany({ where: { userId: session.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw new HttpError(401, 'This account has been deactivated');
    }
    // Claim the rotation atomically: only one concurrent refresh with this token succeeds.
    const claimed = await prisma.staffSession.updateMany({
      where: { id: session.id, rotatedAt: null, revokedAt: null },
      data: { rotatedAt: new Date() },
    });
    if (claimed.count === 0) throw new HttpError(401, 'Invalid refresh token');
    res.json({ ok: true, ...(await issueTokens(session.user, req)) });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const parsed = z.object({ refreshToken: z.string().max(500) }).safeParse(req.body);
    if (parsed.success) {
      await prisma.staffSession.updateMany({
        where: { tokenHash: hashToken(parsed.data.refreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.sub },
      select: { id: true, name: true, email: true, role: true, phone: true, isActive: true },
    });
    if (!user || !user.isActive) throw new HttpError(401, 'Not authenticated');
    res.json({ ok: true, user });
  }),
);
