import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

/** Thrown by route handlers for expected error responses. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Extra JSON fields merged into the error response (e.g. the matching record). */
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Wrap an async route handler so thrown errors reach the error middleware. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

function zodMessage(err: ZodError): string {
  const first = err.issues[0];
  if (!first) return 'Validation failed';
  const path = first.path.join('.');
  return path ? `${path}: ${first.message}` : first.message;
}

/** Central error handler — mount last. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ ok: false, error: zodMessage(err), issues: err.issues });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ ok: false, error: err.message, ...err.details });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = (err.meta?.target as string[] | string | undefined) ?? 'value';
      const field = Array.isArray(target) ? target.join(', ') : target;
      return res.status(409).json({ ok: false, error: `A record with this ${field} already exists` });
    }
    if (err.code === 'P2025') return res.status(404).json({ ok: false, error: 'Record not found' });
    if (err.code === 'P2003') {
      return res
        .status(409)
        .json({ ok: false, error: 'This record is linked to other records and cannot be changed or removed' });
    }
    if (err.code === 'P2023') return res.status(400).json({ ok: false, error: 'Invalid identifier' });
  }
  const anyErr = err as { name?: string; code?: string; type?: string; status?: number; message?: string };
  if (anyErr?.name === 'MulterError') {
    const msg = anyErr.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : `Upload rejected: ${anyErr.message}`;
    return res.status(400).json({ ok: false, error: msg });
  }
  if (anyErr?.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, error: 'Request body is not valid JSON' });
  }
  if (anyErr?.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, error: 'Request is too large' });
  }

  // Unexpected: log the full error server-side under a reference the admin can quote.
  const errorId = crypto.randomBytes(4).toString('hex');
  console.error(`[error ${errorId}] ${req.method} ${req.originalUrl}`, err);
  return res
    .status(500)
    .json({ ok: false, error: `Internal server error (ref ${errorId}). Please try again; if it keeps happening, quote this reference.`, errorId });
}
