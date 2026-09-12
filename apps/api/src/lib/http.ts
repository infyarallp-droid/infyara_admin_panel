import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

/** Thrown by route handlers for expected error responses. */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
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

/** Central error handler — mount last. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ ok: false, error: 'Validation failed', issues: err.issues });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ ok: false, error: err.message });
  }
  console.error(err);
  return res.status(500).json({ ok: false, error: 'Internal server error' });
}
