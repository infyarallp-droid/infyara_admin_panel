import { env } from './env.js';

const GRAPH = 'https://graph.facebook.com/v20.0';

interface SendResult {
  ok: boolean;
  skipped?: boolean;
  id?: string;
  error?: string;
}

function configured(): boolean {
  return !!(env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_ACCESS_TOKEN);
}

async function post(body: unknown): Promise<SendResult> {
  if (!configured()) return { ok: false, skipped: true };
  try {
    const resp = await fetch(`${GRAPH}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const json = (await resp.json()) as { messages?: { id: string }[]; error?: { message: string } };
    if (!resp.ok) return { ok: false, error: json.error?.message ?? `HTTP ${resp.status}` };
    return { ok: true, id: json.messages?.[0]?.id };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Send an approved WhatsApp template message (required for business-initiated msgs). */
export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  bodyParams: string[] = [],
  languageCode = 'en',
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
