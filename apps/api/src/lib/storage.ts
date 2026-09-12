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
  const ext = path.extname(filename) || '';
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
  if (!sb) return putLocal(key, data); // misconfigured → don't lose the file
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
