import { Router, type Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { normalizeIndianMobile, todayISO } from '@moksha/shared';
import { env } from '../../lib/env.js';
import { onContentChange } from '../../lib/revalidate.js';
import { asyncHandler, HttpError } from '../../lib/http.js';
import { clientIp, hit, limitByIp } from '../../lib/rateLimit.js';
import { requireWebsite } from '../../middleware/customerAuth.js';
import { loadPublicSite, type PublicSite } from '../cms/public.routes.js';
import { createLead } from '../leads/leads.service.js';
import { chatbotSettings, systemPrompt } from './knowledge.js';

// Website AI chatbot (Claude). The browser talks to the website's own /api/chat route, which
// forwards here with the service key, so the Anthropic key never leaves this server.
// The reply streams back as NDJSON lines: {"t":"text","v":"…"} … {"t":"saved"} … {"t":"done"}.
export const chatbotRouter = Router();

const MAX_TOOL_ROUNDS = 3;
const HISTORY_MESSAGES = 16;
// Covers Claude's (adaptive) thinking plus a short reply; a cost cap for a public chat.
const MAX_TOKENS = 8000;

let client: Anthropic | null = null;
const claude = () => (client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 1 }));

// Content changes rarely; one DB round-trip per minute is plenty, and publishing clears it.
let siteCache: { at: number; site: PublicSite } | null = null;
async function site(): Promise<PublicSite> {
  if (!siteCache || Date.now() - siteCache.at > 60_000) siteCache = { at: Date.now(), site: await loadPublicSite(false) };
  return siteCache.site;
}
onContentChange(() => (siteCache = null));

const chatSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(2000) }))
    .min(1)
    .max(60)
    .refine((m) => m[m.length - 1].role === 'user', 'The last message must be from the visitor'),
});

const SAVE_ENQUIRY: Anthropic.Beta.BetaTool = {
  name: 'save_enquiry',
  description:
    "Send the visitor's details to the studio team as a new enquiry so they can contact the visitor. Only call this after the visitor has clearly agreed to share these details.",
  // Inputs stream as generated; they are validated below (enquiryInput) before anything is saved.
  eager_input_streaming: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'mobile', 'interest', 'preferred_mode', 'note'],
    properties: {
      name: { type: 'string', description: "The visitor's name" },
      mobile: { type: 'string', description: "The visitor's 10-digit Indian mobile number, as they gave it" },
      interest: { type: 'string', description: 'The class, programme or topic they are interested in; empty string if not known' },
      preferred_mode: { type: 'string', enum: ['Studio', 'Online', 'No preference'] },
      note: {
        type: 'string',
        description: 'One or two sentences for the team: what the visitor wants (e.g. a trial class, a call back); empty string if nothing to add',
      },
    },
  },
};

const enquiryInput = z.object({
  name: z.string().trim().min(1).max(80),
  mobile: z.string().trim().max(30),
  interest: z.string().trim().max(200),
  preferred_mode: z.enum(['Studio', 'Online', 'No preference']),
  note: z.string().trim().max(600),
});

type ToolResult = { ok: true; message: string } | { ok: false; error: string };

async function saveEnquiry(input: unknown, ip: string, visitorMessages: string[]): Promise<ToolResult> {
  const parsed = enquiryInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'The details were incomplete. Ask the visitor for their name and mobile number again.' };
  const args = parsed.data;
  const phone = normalizeIndianMobile(args.mobile);
  if (!phone) return { ok: false, error: 'That is not a valid 10-digit Indian mobile number. Ask the visitor to check it.' };
  if ((await hit(`chat-lead:ip:${ip}`, 60 * 60_000)) > 3) {
    return { ok: false, error: 'Several enquiries were already sent from this device. Ask the visitor to message the studio on WhatsApp instead.' };
  }
  const message = [
    args.interest ? `Interested in: ${args.interest}` : null,
    args.preferred_mode !== 'No preference' ? `Preferred format: ${args.preferred_mode}` : null,
    args.note || null,
  ]
    .filter(Boolean)
    .join('\n');
  const lead = await createLead({
    name: args.name,
    phone,
    message: message || 'Enquiry from the website chatbot',
    source: 'WEBSITE',
    sourceDetail: {
      form: 'website-chatbot',
      interest: args.interest || null,
      preferredMode: args.preferred_mode,
      // What the visitor wrote, so the team has the context when they call back.
      visitorMessages: visitorMessages.slice(-8).map((m) => m.slice(0, 400)),
    },
  });
  return { ok: true, message: `Saved (reference ${lead.id.slice(0, 8)}). The team will contact the visitor on ${phone}.` };
}

function send(res: Response, event: Record<string, unknown>) {
  if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
}

const UNAVAILABLE = 'Sorry, I cannot answer right now. Please message us on WhatsApp or use the enquiry form at /contact#enquire.';

/** Visitor-facing text for a failed Claude call; the real reason goes to the server log. */
function describeFailure(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) console.error('[chatbot] ANTHROPIC_API_KEY was rejected — check the key on the API server');
  else if (err instanceof Anthropic.NotFoundError) console.error(`[chatbot] Anthropic does not know the model "${env.CHATBOT_MODEL}" — check CHATBOT_MODEL`);
  else if (err instanceof Anthropic.RateLimitError) console.error('[chatbot] Anthropic rate limit reached:', err.message);
  else if (err instanceof Anthropic.BadRequestError)
    console.error('[chatbot] Anthropic rejected the request (if it mentions credit, add credit at console.anthropic.com → Billing):', err.message);
  else if (err instanceof Anthropic.APIError) console.error(`[chatbot] Anthropic error ${err.status ?? ''}:`, err.message);
  else console.error('[chatbot] failed:', (err as Error)?.message ?? err);
  return UNAVAILABLE;
}

chatbotRouter.post(
  '/',
  requireWebsite,
  limitByIp('chat-burst', 12, 60_000, 'You are sending messages very quickly. Please wait a minute.'),
  asyncHandler(async (req, res) => {
    if (!env.ANTHROPIC_API_KEY) throw new HttpError(503, 'The chat assistant is not switched on.');
    const { messages } = chatSchema.parse(req.body);
    const current = await site();
    const settings = chatbotSettings(current);
    if (settings.status === 'off') throw new HttpError(503, 'The chat assistant is switched off.');

    // Cost guards: per visitor per day, and for the whole website per day.
    const ip = clientIp(req);
    const day = todayISO(env.BUSINESS_TIMEZONE);
    if ((await hit(`chat-day:ip:${ip}:${day}`, 26 * 3600_000)) > env.CHATBOT_VISITOR_DAILY_LIMIT) {
      throw new HttpError(429, 'You have reached today’s chat limit. Please message us on WhatsApp and the team will help you.');
    }
    if ((await hit(`chat-day:all:${day}`, 26 * 3600_000)) > env.CHATBOT_DAILY_LIMIT) {
      console.warn(`[chatbot] daily limit of ${env.CHATBOT_DAILY_LIMIT} replies reached (CHATBOT_DAILY_LIMIT)`);
      throw new HttpError(503, 'The assistant is very busy today. Please message us on WhatsApp and the team will help you.');
    }

    const history = messages.slice(-HISTORY_MESSAGES);
    const conversation: Anthropic.Beta.BetaMessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));
    // The API needs the conversation to start with the visitor.
    while (conversation[0]?.role === 'assistant') conversation.shift();
    const visitorMessages = history.filter((m) => m.role === 'user').map((m) => m.content);
    // Stable instructions + studio facts are cached (render order: tools → system); the clock goes after the breakpoint.
    const system: Anthropic.Beta.BetaTextBlockParam[] = [
      { type: 'text', text: systemPrompt(current, settings), cache_control: { type: 'ephemeral' } },
      {
        type: 'text',
        text: `Current date and time at the studio: ${new Date().toLocaleString('en-IN', { timeZone: env.BUSINESS_TIMEZONE, dateStyle: 'full', timeStyle: 'short' })}.`,
      },
    ];
    // A declined request is retried server-side on the model Anthropic recommends (not offered for Haiku).
    const fallback = /haiku/.test(env.CHATBOT_MODEL) ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const };

    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });

    let leadSaved = false;
    let jsonRetries = 0;
    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        let streamedText = false;
        const stream = claude().beta.messages.stream(
          {
            model: env.CHATBOT_MODEL,
            max_tokens: MAX_TOKENS,
            output_config: { effort: env.CHATBOT_EFFORT },
            system,
            tools: [SAVE_ENQUIRY],
            messages: conversation,
            ...fallback,
          },
          { signal: abort.signal },
        );
        stream.on('text', (delta) => {
          streamedText = true;
          send(res, { t: 'text', v: delta });
        });

        let message: Anthropic.Beta.BetaMessage;
        try {
          message = await stream.finalMessage();
          jsonRetries = 0;
        } catch (err) {
          // Only a tool input that could not be parsed at all is retried; API errors go to the visitor notice.
          if (err instanceof Anthropic.APIError || abort.signal.aborted || streamedText || jsonRetries++ >= 2) throw err;
          round--;
          continue;
        }
        const u = message.usage;
        console.info(
          `[chatbot] model=${message.model} tokens in=${u.input_tokens} cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} out=${u.output_tokens}`,
        );

        if (message.stop_reason === 'refusal') {
          send(res, { t: 'error', v: 'Sorry, I can’t help with that here. For anything about our classes, please ask away, or message us on WhatsApp.' });
          break;
        }
        const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
        // A tool input cut off at max_tokens can still look valid, so never run it.
        if (message.stop_reason !== 'tool_use' || !toolUses.length) break;

        // Pass the assistant turn back unchanged (it includes Claude's thinking blocks).
        conversation.push({ role: 'assistant', content: message.content });
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const use of toolUses) {
          let result: ToolResult;
          if (use.name !== 'save_enquiry') result = { ok: false, error: `Unknown tool ${use.name}` };
          else if (leadSaved) result = { ok: false, error: 'The details were already sent in this reply.' };
          else {
            try {
              result = await saveEnquiry(use.input, ip, visitorMessages);
            } catch (err) {
              console.error('[chatbot] could not save the enquiry:', (err as Error).message);
              result = { ok: false, error: 'The enquiry could not be saved. Give the visitor the WhatsApp number or /contact#enquire instead.' };
            }
          }
          if (result.ok) {
            leadSaved = true;
            send(res, { t: 'saved' });
          }
          results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(result), ...(result.ok ? {} : { is_error: true }) });
        }
        conversation.push({ role: 'user', content: results });
        if (streamedText) send(res, { t: 'text', v: '\n\n' });
      }
      send(res, { t: 'done' });
    } catch (err) {
      if (!abort.signal.aborted) send(res, { t: 'error', v: describeFailure(err) });
    } finally {
      res.end();
    }
  }),
);
