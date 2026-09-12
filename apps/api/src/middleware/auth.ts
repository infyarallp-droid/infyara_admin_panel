import type { NextFunction, Request, Response } from 'express';
import type { UserRole } from '@prisma/client';
import { verifyAccessToken, type JwtPayload } from '../lib/jwt.js';
import { HttpError } from '../lib/http.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/** Require a valid access token; attaches req.user. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new HttpError(401, 'Missing or invalid Authorization header');
  }
  try {
    req.user = verifyAccessToken(header.slice(7));
    next();
  } catch {
    throw new HttpError(401, 'Invalid or expired token');
  }
}

/** Require the authenticated user to have one of the given roles. */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    if (!roles.includes(req.user.role)) throw new HttpError(403, 'Insufficient permissions');
    next();
  };
}
