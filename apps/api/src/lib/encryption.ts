import crypto from 'node:crypto';
import { env } from './env.js';

// AES-256-GCM column encryption for sensitive PII (Aadhaar/PAN) and
// integration tokens. Stored as: base64(iv).base64(authTag).base64(ciphertext)
const KEY = Buffer.from(env.ENCRYPTION_KEY, 'hex'); // 32 bytes
const ALGO = 'aes-256-gcm';

export function encrypt(plain: string | null | undefined): string | null {
  if (plain == null || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
}

export function decrypt(payload: string | null | undefined): string | null {
  if (!payload) return null;
  const [ivB64, tagB64, dataB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !dataB64) return null;
  const decipher = crypto.createDecipheriv(ALGO, KEY, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return dec.toString('utf8');
}

/** Mask for display, e.g. Aadhaar -> XXXX XXXX 1234 */
export function maskTail(value: string | null, visible = 4): string | null {
  if (!value) return null;
  const tail = value.slice(-visible);
  return `${'X'.repeat(Math.max(0, value.length - visible))}${tail}`;
}
