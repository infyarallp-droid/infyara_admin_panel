import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { loginSchema } from '@moksha/shared';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, HttpError } from '../../lib/http.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../lib/jwt.js';
import { requireAuth } from '../../middleware/auth.js';

export const authRouter = Router();

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) throw new HttpError(401, 'Invalid credentials');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new HttpError(401, 'Invalid credentials');

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const payload = { sub: user.id, role: user.role, name: user.name };
    res.json({
      ok: true,
      accessToken: signAccessToken(payload),
      refreshToken: signRefreshToken(payload),
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  }),
);

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const { refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body);
    try {
      const payload = verifyRefreshToken(refreshToken);
      const fresh = { sub: payload.sub, role: payload.role, name: payload.name };
      res.json({ ok: true, accessToken: signAccessToken(fresh), refreshToken: signRefreshToken(fresh) });
    } catch {
      throw new HttpError(401, 'Invalid refresh token');
    }
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.sub },
      select: { id: true, name: true, email: true, role: true, phone: true },
    });
    if (!user) throw new HttpError(404, 'User not found');
    res.json({ ok: true, user });
  }),
);
