import { SignJWT } from 'jose';
import { env } from './env.js';

// After an admin publishes content, tell the website to refresh its cached pages
// (Next.js on-demand revalidation). Failure is logged, never fatal: the website
// also refreshes on its own every few minutes.

let pending: NodeJS.Timeout | null = null;

// In-process caches of website content (e.g. the chatbot's) register here to be dropped on publish.
const contentListeners = new Set<() => void>();
export function onContentChange(listener: () => void): void {
  contentListeners.add(listener);
}

export function revalidateWebsite(reason: string): void {
  for (const listener of contentListeners) listener();
  if (!env.WEBSITE_URL || !env.WEBSITE_REVALIDATE_SECRET) return;
  // Several edits in a row trigger a single refresh.
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    fetch(`${env.WEBSITE_URL!.replace(/\/+$/, '')}/api/revalidate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-revalidate-secret': env.WEBSITE_REVALIDATE_SECRET! },
      body: JSON.stringify({ reason }),
      signal: AbortSignal.timeout(10_000),
    })
      .then((r) => {
        if (!r.ok) console.error(`[revalidate] website answered ${r.status}`);
      })
      .catch((err) => console.error('[revalidate] website unreachable:', (err as Error).name));
  }, 1500);
  pending.unref?.();
}

/** A short-lived token the website accepts to show unpublished drafts (signed with the shared service key). */
export async function previewToken(): Promise<string> {
  return new SignJWT({ scope: 'preview' })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience('moksha-website-preview')
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(new TextEncoder().encode(env.WEBSITE_SERVICE_KEY));
}
