import { normalizeMobile } from '@moksha/shared';
import { env } from './env.js';

export interface SendResult {
  ok: boolean;
  /** True when the integration has no credentials — nothing was sent. */
  skipped?: boolean;
  id?: string;
  error?: string;
  httpStatus?: number;
  /** Provider asked us to slow down (HTTP 429 / Meta rate-limit codes). */
  rateLimited?: boolean;
  /** Worth trying again later (network error, timeout, 5xx, rate limit). */
  retryable?: boolean;
  /** Provider's JSON response, stored for the message log (contains no credentials). */
  response?: unknown;
}

const RATE_LIMIT_CODES = new Set([4, 80007, 130429, 131048, 131056]);

export function isWhatsAppConfigured(): boolean {
  return !!(env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_ACCESS_TOKEN);
}

/**
 * Turn a stored mobile into the international digits WhatsApp expects
 * (e.g. 9876543210 → 919876543210). Returns null for anything that is not a
 * plausible mobile number, so we never call the provider with a bad recipient.
 */
export function toWhatsAppRecipient(mobile: string | null | undefined): string | null {
  if (!mobile) return null;
  const local = normalizeMobile(mobile);
  if (local) return /^[6-9]/.test(local) ? `${env.WHATSAPP_DEFAULT_COUNTRY_CODE}${local}` : null;
  // Already-international numbers (e.g. +44…) are accepted as-is.
  const digits = mobile.replace(/[\s\-().]/g, '');
  return /^\+\d{8,15}$/.test(digits) ? digits.slice(1) : null;
}

async function post(body: unknown): Promise<SendResult> {
  if (!isWhatsAppConfigured()) return { ok: false, skipped: true, error: 'WhatsApp is not configured' };
  try {
    const resp = await fetch(`${env.WHATSAPP_API_BASE_URL}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await resp.json().catch(() => null)) as {
      messages?: { id: string }[];
      error?: { message?: string; code?: number };
    } | null;
    if (!resp.ok) {
      const rateLimited = resp.status === 429 || (json?.error?.code != null && RATE_LIMIT_CODES.has(json.error.code));
      return {
        ok: false,
        httpStatus: resp.status,
        error: json?.error?.message ?? `HTTP ${resp.status}`,
        rateLimited,
        retryable: rateLimited || resp.status >= 500,
        response: json,
      };
    }
    return { ok: true, httpStatus: resp.status, id: json?.messages?.[0]?.id, response: json };
  } catch (err) {
    // Network failure / timeout. The error message never includes the access token.
    return { ok: false, error: (err as Error).message, retryable: true };
  }
}

/** Send an approved WhatsApp template message (required for business-initiated msgs). */
export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  bodyParams: string[] = [],
  languageCode: string = env.WHATSAPP_TEMPLATE_LANG,
): Promise<SendResult> {
  return post({
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components: bodyParams.length
        ? [{ type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text })) }]
        : [],
    },
  });
}

/** Send a plain text message (only valid within a 24h customer-service window). */
export async function sendWhatsAppText(to: string, body: string): Promise<SendResult> {
  return post({ messaging_product: 'whatsapp', to, type: 'text', text: { body } });
}
