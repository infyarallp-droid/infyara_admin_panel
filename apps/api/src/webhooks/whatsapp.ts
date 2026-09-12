import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import { env } from '../lib/env.js';
import { asyncHandler } from '../lib/http.js';
import { createLead, logWebhook } from '../modules/leads/leads.service.js';

// Meta WhatsApp Business Cloud API webhook.
// GET  = verification handshake (hub.challenge).
// POST = inbound messages → leads, with X-Hub-Signature-256 validation.
export const whatsappRouter = Router();

// Verification handshake
whatsappRouter.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(String(challenge));
  }
  return res.sendStatus(403);
});

function verifySignature(req: Request): boolean | null {
  if (!env.WHATSAPP_APP_SECRET) return null; // not configured → skip (dev)
  const sig = req.headers['x-hub-signature-256'];
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  if (typeof sig !== 'string' || !raw) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', env.WHATSAPP_APP_SECRET).update(raw).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

whatsappRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const valid = verifySignature(req);
    if (valid === false) {
      await logWebhook('whatsapp', req.body ?? {}, false, 'Invalid signature');
      return res.sendStatus(401);
    }

    // Ack fast (Meta retries on non-200), then process.
    res.sendStatus(200);
    await logWebhook('whatsapp', req.body ?? {}, valid);

    try {
      const entries = req.body?.entry ?? [];
      for (const entry of entries) {
        for (const change of entry.changes ?? []) {
          const value = change.value ?? {};
          const contactName = value.contacts?.[0]?.profile?.name;
          for (const msg of value.messages ?? []) {
            const text = msg.text?.body ?? msg.button?.text ?? `[${msg.type}]`;
            await createLead({
              name: contactName,
              phone: msg.from,
              message: text,
              source: 'WHATSAPP',
              sourceDetail: { messageId: msg.id, type: msg.type },
            });
          }
        }
      }
    } catch (err) {
      console.error('[whatsapp] processing error', err);
    }
  }),
);
