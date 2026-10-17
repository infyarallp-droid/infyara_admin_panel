import crypto from 'node:crypto';

/** A new opaque bearer token (URL-safe, 256 bits). */
export function newToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** What is stored in the database: a SHA-256 of the token, never the token itself. */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison for shared secrets of any length. */
export function safeEqual(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** A readable temporary password, e.g. "Lotus-4821-mint". */
export function temporaryPassword(): string {
  const words = ['Lotus', 'River', 'Cedar', 'Breath', 'Stone', 'Maple', 'Ocean', 'Amber', 'Sage', 'Willow'];
  const tails = ['mint', 'calm', 'glow', 'leaf', 'wave', 'dawn', 'rain', 'peak'];
  const w = words[crypto.randomInt(words.length)];
  const t = tails[crypto.randomInt(tails.length)];
  return `${w}-${crypto.randomInt(1000, 10000)}-${t}`;
}
