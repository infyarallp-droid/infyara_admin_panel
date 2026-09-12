import { Router } from 'express';
import { env } from '../lib/env.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { createLead, logWebhook } from '../modules/leads/leads.service.js';

// Bridge for Google Forms. A Google Apps Script `onFormSubmit` trigger POSTs
// the response here with a shared secret. Example Apps Script is in the README.
export const googleFormRouter = Router();

const pick = (obj: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const k of Object.keys(obj)) {
    if (keys.some((want) => k.toLowerCase().includes(want))) return String(obj[k]);
  }
  return undefined;
};

googleFormRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const secret = req.headers['x-shared-secret'] ?? req.body?.secret;
    if (secret !== env.GOOGLE_FORM_SHARED_SECRET) throw new HttpError(401, 'Invalid shared secret');

    const answers = (req.body?.answers ?? req.body ?? {}) as Record<string, unknown>;
    await logWebhook('google-form', req.body ?? {}, true);
    const lead = await createLead({
      name: pick(answers, ['name']),
      phone: pick(answers, ['phone', 'mobile', 'contact']),
      email: pick(answers, ['email']),
      message: pick(answers, ['message', 'comment', 'interest', 'note']),
      source: 'GOOGLE_FORM',
      sourceDetail: answers as never,
    });
    res.status(201).json({ ok: true, leadId: lead.id });
  }),
);
