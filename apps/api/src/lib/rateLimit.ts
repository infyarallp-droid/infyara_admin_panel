import type { NextFunction, Request, Response } from 'express';
import Redis from 'ioredis';
import { env } from './env.js';
import { HttpError } from './http.js';
import { safeEqual } from './tokens.js';

// Fixed-window rate limiter backed by Redis (Upstash in production), so limits
// hold across instances and restarts. If Redis is unreachable it falls back to a
// per-process counter rather than blocking sign-ins or payments.

let client: Redis | null = null;
function redis(): Redis {
  if (!client) {
    client = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      enableOfflineQueue: false, // fail fast when disconnected instead of queueing forever
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
    });
    client.on('error', () => {
      /* logged once per failure in hit(); avoid flooding the log on reconnect loops */
    });
    // A rate-limit connection must never be what keeps a process (a job, a test run) alive.
    client.on('connect', () => (client as unknown as { stream?: { unref?: () => void } }).stream?.unref?.());
  }
  return client;
}

const memory = new Map<string, { count: number; resetAt: number }>();
function memoryHit(key: string, windowMs: number): number {
  const now = Date.now();
  const entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowMs });
    if (memory.size > 20_000) memory.clear();
    return 1;
  }
  entry.count++;
  return entry.count;
}

let warned = false;
/** Count one hit for `key` in the current window and return the total so far. */
export async function hit(key: string, windowMs: number): Promise<number> {
  const k = `rl:${key}`;
  try {
    const r = redis();
    if (r.status === 'wait') await r.connect();
    const results = await r.multi().incr(k).pexpire(k, windowMs, 'NX').exec();
    const count = Number(results?.[0]?.[1]);
    if (!Number.isFinite(count)) throw new Error('unexpected redis reply');
    return count;
  } catch (err) {
    if (!warned) {
      console.error('[rate-limit] Redis unavailable, using in-process limits:', (err as Error).message);
      warned = true;
    }
    return memoryHit(k, windowMs);
  }
}

/** Forget a key (e.g. clear failed-login counters after a successful sign-in). */
export async function reset(key: string): Promise<void> {
  memory.delete(`rl:${key}`);
  try {
    const r = redis();
    if (r.status === 'wait') await r.connect();
    await r.del(`rl:${key}`);
  } catch {
    /* best effort */
  }
}

export function clientIp(req: Request): string {
  // The website's server forwards its visitor's address as x-client-ip; trusted only with the service key,
  // otherwise anyone could pick their own "IP" and dodge the limits.
  const forwarded = req.headers['x-client-ip'] as string | undefined;
  if (forwarded && safeEqual(req.headers['x-service-key'] as string | undefined, env.WEBSITE_SERVICE_KEY)) {
    return forwarded.split(',')[0].trim().slice(0, 64);
  }
  // app.set('trust proxy', 1) makes req.ip the client address behind Render's proxy.
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/** Express middleware: at most `max` requests per `windowMs` per client IP for this route group. */
export function limitByIp(name: string, max: number, windowMs: number, message = 'Too many attempts. Please wait a few minutes and try again.') {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const count = await hit(`${name}:ip:${clientIp(req)}`, windowMs);
      if (count > max) return next(new HttpError(429, message));
      next();
    } catch (err) {
      next(err);
    }
  };
}
