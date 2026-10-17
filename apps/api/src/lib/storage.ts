import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env.js';

// Pluggable file storage. Local provider (dev) writes under ./uploads and serves
// via the API's static route. In production set STORAGE_PROVIDER=supabase|r2 and
// implement putObject there (returns a signed/public URL).

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');

export interface StoredFile {
  key: string;
  url: string;
}

function safeKey(prefix: string, filename: string): string {
  // Only a short alphanumeric extension survives — the stored name is never user-controlled.
  const rawExt = path.extname(filename).toLowerCase();
  const ext = /^[.][a-z0-9]{1,8}$/.test(rawExt) ? rawExt : '';
  const id = crypto.randomBytes(8).toString('hex');
  return `${prefix}/${Date.now()}-${id}${ext}`;
}

async function putLocal(key: string, data: Buffer): Promise<StoredFile> {
  const full = path.join(UPLOAD_DIR, key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, data);
  return { key, url: `${env.API_PUBLIC_URL}/uploads/${key}` };
}

// Supabase Storage (private bucket + long-lived signed URLs).
let _supabase: SupabaseClient | null = null;
function supabase(): SupabaseClient | null {
  if (_supabase) return _supabase;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return null;
  _supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
  return _supabase;
}

const SIGNED_URL_TTL = 60 * 60 * 24 * 365; // 1 year

async function putSupabase(key: string, data: Buffer, contentType?: string): Promise<StoredFile> {
  const sb = supabase();
  if (!sb) {
    // On a server with an ephemeral disk a "local" fallback silently loses the file on the next deploy.
    if (env.NODE_ENV === 'production') throw new Error('File storage is unavailable (SUPABASE_URL / SUPABASE_SERVICE_KEY not set)');
    return putLocal(key, data);
  }
  const { error } = await sb.storage
    .from(env.SUPABASE_BUCKET)
    .upload(key, data, { contentType, upsert: true });
  if (error) throw new Error(`Supabase upload failed: ${error.message}`);
  const { data: signed, error: signErr } = await sb.storage
    .from(env.SUPABASE_BUCKET)
    .createSignedUrl(key, SIGNED_URL_TTL);
  if (signErr || !signed) throw new Error(`Supabase sign failed: ${signErr?.message}`);
  return { key, url: signed.signedUrl };
}

/** Store a file buffer and return its key + URL (private-signed in prod). */
export async function putObject(
  prefix: string,
  filename: string,
  data: Buffer,
  contentType?: string,
): Promise<StoredFile> {
  const key = safeKey(prefix, filename);
  switch (env.STORAGE_PROVIDER) {
    case 'supabase':
      return putSupabase(key, data, contentType);
    // 'r2' can be added with @aws-sdk/client-s3 against the R2 S3 endpoint.
    case 'local':
    default:
      return putLocal(key, data);
  }
}

/**
 * Read a stored file back by its key (used to serve private files through
 * authenticated API routes instead of handing out storage URLs).
 */
export async function getObject(key: string): Promise<Buffer> {
  if (env.STORAGE_PROVIDER === 'supabase') {
    const sb = supabase();
    if (sb) {
      const { data, error } = await sb.storage.from(env.SUPABASE_BUCKET).download(key);
      if (!error && data) return Buffer.from(await data.arrayBuffer());
      // Fall through: the file may have been written locally while storage was misconfigured.
    }
  }
  const full = path.resolve(UPLOAD_DIR, key);
  if (!full.startsWith(UPLOAD_DIR + path.sep)) throw new Error('Invalid storage key');
  return fs.readFile(full);
}

/** Store a data: URL (e.g. a signature-pad PNG) and return its key + URL. */
export async function putDataUrl(prefix: string, dataUrl: string): Promise<StoredFile> {
  const match = /^data:(.+?);base64,(.*)$/.exec(dataUrl);
  if (!match) throw new Error('Invalid data URL');
  const contentType = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  const ext = contentType.split('/')[1] ?? 'png';
  return putObject(prefix, `signature.${ext}`, buffer, contentType);
}

export const uploadDir = UPLOAD_DIR;

// ── Public website media (team photos, testimonials, gallery) ──
// Stored in a separate PUBLIC bucket so the website can serve them directly with
// permanent URLs. Never put private documents here.

/** Store a public file; returns its permanent public URL. */
export async function putPublicObject(prefix: string, filename: string, data: Buffer, contentType: string): Promise<StoredFile> {
  const key = safeKey(prefix, filename);
  if (env.STORAGE_PROVIDER === 'supabase') {
    const sb = supabase();
    if (sb) {
      const { error } = await sb.storage
        .from(env.SUPABASE_PUBLIC_BUCKET)
        .upload(key, data, { contentType, upsert: false, cacheControl: '31536000' });
      if (error) throw new Error(`Supabase upload failed: ${error.message}`);
      const { data: pub } = sb.storage.from(env.SUPABASE_PUBLIC_BUCKET).getPublicUrl(key);
      return { key, url: pub.publicUrl };
    }
    if (env.NODE_ENV === 'production') throw new Error('File storage is unavailable (SUPABASE_URL / SUPABASE_SERVICE_KEY not set)');
  }
  const stored = await putLocal(`public/${key}`, data);
  return { key, url: stored.url };
}

/** Remove a public file (best effort — a missing file is not an error). */
export async function deletePublicObject(key: string): Promise<void> {
  if (env.STORAGE_PROVIDER === 'supabase') {
    const sb = supabase();
    if (sb) {
      await sb.storage.from(env.SUPABASE_PUBLIC_BUCKET).remove([key]);
      return;
    }
  }
  const full = path.resolve(UPLOAD_DIR, 'public', key);
  if (!full.startsWith(UPLOAD_DIR + path.sep)) return;
  await fs.rm(full, { force: true });
}

export type MediaType = { kind: 'IMAGE' | 'VIDEO'; mime: string; ext: string };

/**
 * Identify an upload from its first bytes (never trust the browser's file name or type).
 * Only formats a browser can show safely are accepted — no SVG (it can carry scripts).
 */
export function sniffMedia(buf: Buffer): MediaType | null {
  const b = buf.subarray(0, 16);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'IMAGE', mime: 'image/jpeg', ext: '.jpg' };
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: 'IMAGE', mime: 'image/png', ext: '.png' };
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return { kind: 'IMAGE', mime: 'image/webp', ext: '.webp' };
  if (b.toString('latin1', 0, 6) === 'GIF87a' || b.toString('latin1', 0, 6) === 'GIF89a') return { kind: 'IMAGE', mime: 'image/gif', ext: '.gif' };
  if (b.toString('latin1', 4, 8) === 'ftyp') {
    const brand = b.toString('latin1', 8, 12);
    if (['avif', 'avis'].includes(brand)) return { kind: 'IMAGE', mime: 'image/avif', ext: '.avif' };
    if (brand.startsWith('qt')) return { kind: 'VIDEO', mime: 'video/quicktime', ext: '.mov' };
    return { kind: 'VIDEO', mime: 'video/mp4', ext: '.mp4' };
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { kind: 'VIDEO', mime: 'video/webm', ext: '.webm' };
  return null;
}
