import type { Request } from 'express';
import type { AuthMethod, CustomerAccount } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../lib/env.js';
import { clientIp } from '../../lib/rateLimit.js';
import { hashToken, newToken } from '../../lib/tokens.js';
import type { Tx } from '../../lib/counters.js';

/** Create a website session and return the bearer token (shown once, stored only as a hash). */
export async function createSession(accountId: string, req: Request, tx: Tx = prisma) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + env.CUSTOMER_SESSION_DAYS * 86_400_000);
  await tx.customerSession.create({
    data: {
      accountId,
      tokenHash: hashToken(token),
      expiresAt,
      userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
      ip: clientIp(req),
    },
  });
  return { token, expiresAt };
}

/** Log a sign-in attempt for the Website Logins page; successful ones also bump the account counters. */
export async function recordLogin(
  req: Request,
  args: { accountId?: string | null; mobile?: string | null; method: AuthMethod; success: boolean; reason?: string },
  tx: Tx = prisma,
) {
  await tx.customerLoginEvent.create({
    data: {
      accountId: args.accountId ?? null,
      mobile: args.mobile ?? null,
      method: args.method,
      success: args.success,
      reason: args.reason ?? null,
      ip: clientIp(req),
      userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
    },
  });
  if (args.success && args.accountId) {
    await tx.customerAccount.update({
      where: { id: args.accountId },
      data: { lastLoginAt: new Date(), loginCount: { increment: 1 } },
    });
  }
}

/** What the website may know about an account (never the password hash). */
export function presentAccount(a: CustomerAccount & { identities?: { provider: string; email: string | null }[] }) {
  return {
    id: a.id,
    fullName: a.fullName,
    mobile: a.mobile,
    email: a.email,
    signupMethod: a.signupMethod,
    hasPassword: !!a.passwordHash,
    mustChangePassword: a.mustChangePassword,
    linkedToStudent: !!a.studentId,
    google: a.identities?.find((i) => i.provider === 'GOOGLE')?.email ?? (a.identities?.some((i) => i.provider === 'GOOGLE') ? '' : null),
    createdAt: a.createdAt,
  };
}
