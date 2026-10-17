import type { NextFunction, Request, Response } from 'express';
import type { CustomerAccount } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { env } from '../lib/env.js';
import { HttpError } from '../lib/http.js';
import { hashToken, safeEqual } from '../lib/tokens.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      customer?: CustomerAccount;
      customerSessionId?: string;
    }
  }
}

const SEEN_UPDATE_MS = 5 * 60_000;

/**
 * Only the website's own server may call account/auth endpoints: it holds the
 * service key and the visitor's session cookie. Browsers never call these directly.
 */
export function requireWebsite(req: Request, _res: Response, next: NextFunction) {
  if (!safeEqual(req.headers['x-service-key'] as string | undefined, env.WEBSITE_SERVICE_KEY)) {
    return next(new HttpError(401, 'Unknown client'));
  }
  next();
}

/** Resolve the website session (Bearer token) to an active account; attaches req.customer. */
export async function requireCustomer(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!safeEqual(req.headers['x-service-key'] as string | undefined, env.WEBSITE_SERVICE_KEY)) {
      throw new HttpError(401, 'Unknown client');
    }
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'Please sign in');
    const session = await prisma.customerSession.findUnique({
      where: { tokenHash: hashToken(header.slice(7)) },
      include: { account: true },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) throw new HttpError(401, 'Your session has ended. Please sign in again.');
    if (session.account.status !== 'ACTIVE') throw new HttpError(403, 'This account is suspended. Please contact the studio.');
    if (Date.now() - session.lastSeenAt.getTime() > SEEN_UPDATE_MS) {
      await prisma.customerSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    }
    req.customer = session.account;
    req.customerSessionId = session.id;
    next();
  } catch (err) {
    next(err);
  }
}
