import { Router } from 'express';
import { publicLeadSchema } from '@moksha/shared';
import { env } from '../lib/env.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { createLead, logWebhook } from '../modules/leads/leads.service.js';

// Public lead intake for the website form, Zapier/Make (LinkedIn, Instagram, …),
// and any generic channel. Secured by an API key header.
export const publicLeadsRouter = Router();

publicLeadsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const key = req.headers['x-api-key'];
    if (key !== env.PUBLIC_LEADS_API_KEY) throw new HttpError(401, 'Invalid API key');

    const input = publicLeadSchema.parse(req.body);
    await logWebhook('public', req.body ?? {}, true);
    const lead = await createLead({
      name: input.name,
      phone: input.phone,
      email: input.email || null,
      message: input.message,
      source: input.source,
      sourceDetail: input.sourceDetail as never,
    });
    res.status(201).json({ ok: true, leadId: lead.id });
  }),
);
