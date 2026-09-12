import Redis from 'ioredis';
import { env } from './env.js';

// Shared Redis connection (Upstash in prod). Used for cache, rate-limit, and
// as the BullMQ connection in later milestones.
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
});

redis.on('error', (err) => console.error('[redis]', err.message));
