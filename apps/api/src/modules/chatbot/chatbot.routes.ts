import { Router, type Response } from 'express';
import OpenAI from 'openai';
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

// Website AI chatbot (OpenAI). The browser talks to the website's own /api/chat route, which
// forwards here with the service key, so the OpenAI key never leaves this server.
// The reply streams back as NDJSON lines: {"t":"text","v":"…"} … {"t":"saved"} … {"t":"done"}.
export const chatbotRouter = Router();

const MAX_TOOL_ROUNDS = 3;
const HISTORY_MESSAGES = 16;
const MAX_REPLY_TOKENS = 1200;

let client: OpenAI | null = null;
const openai = () =>
  (client ??= new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    timeout: 45_000,
    maxRetries: 1,
  }));

// Content changes rarely; one DB round-trip per minute is plenty.
let siteCache: { at: number; site: PublicSite } | null = null;
async function site(): Promise<PublicSite> {
  if (!siteCache || Date.now() - siteCache.at > 60_000) siteCache = { at: Date.now(), site: await loadPublicSite(false) };
  return siteCache.site;
}
onContentChange(() => (siteCache = null));

const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(2000),
      }),
    )
    .min(1)
    .max(60)
    .refine((m) => m[m.length - 1].role === 'user', 'The last message must be from the visitor'),
});

const SAVE_ENQUIRY: OpenAI.Chat.ChatCompletionFunctionTool = {
  type: 'function',
  function: {
    name: 'save_enquiry',
    description:
      "Send the visitor's details to the studio team as a new enquiry so they can contact the visitor. Only call this after the visitor has clearly agreed to share these details.",
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'mobile', 'interest', 'preferred_mode', 'note'],
      properties: {
        name: { type: 'string', description: "The visitor's name" },
        mobile: {
          type: 'string',
          description: "The visitor's 10-digit Indian mobile number, as they gave it",
        },
        interest: {
          type: 'string',
          description: 'The class, programme or topic they are interested in; empty string if not known',
        },
        preferred_mode: {
          type: 'string',
          enum: ['Studio', 'Online', 'No preference'],
        },
        note: {
          type: 'string',
          description: 'One or two sentences for the team: what the visitor wants (e.g. a trial class, a call back); empty string if nothing to add',
        },
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

async function saveEnquiry(rawArgs: string, ip: string, visitorMessages: string[]): Promise<ToolResult> {
  let args: z.infer<typeof enquiryInput>;
  try {
    args = enquiryInput.parse(JSON.parse(rawArgs));
  } catch {
    return {
      ok: false,
      error: 'The details were incomplete. Ask the visitor for their name and mobile number again.',
    };
  }
  const phone = normalizeIndianMobile(args.mobile);
  if (!phone)
    return {
      ok: false,
      error: 'That is not a valid 10-digit Indian mobile number. Ask the visitor to check it.',
    };
  if ((await hit(`chat-lead:ip:${ip}`, 60 * 60_000)) > 3) {
    return {
      ok: false,
      error: 'Several enquiries were already sent from this device. Ask the visitor to message the studio on WhatsApp instead.',
    };
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
  return {
    ok: true,
    message: `Saved (reference ${lead.id.slice(0, 8)}). The team will contact the visitor on ${phone}.`,
  };
}

function send(res: Response, event: Record<string, unknown>) {
  if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
}

/** Visitor-facing text for a failed OpenAI call; the real reason goes to the server log. */
function describeFailure(err: unknown): string {
  if (err instanceof OpenAI.AuthenticationError) console.error('[chatbot] OPENAI_API_KEY was rejected by OpenAI — check the key on the API server');
  else if (err instanceof OpenAI.NotFoundError) console.error(`[chatbot] OpenAI does not know the model "${env.OPENAI_MODEL}" — check OPENAI_MODEL`);
  else if (err instanceof OpenAI.RateLimitError)
    console.error('[chatbot] OpenAI rate limit or quota reached (add credit at platform.openai.com → Billing):', err.message);
  else if (err instanceof OpenAI.APIError) console.error(`[chatbot] OpenAI error ${err.status ?? ''}:`, err.message);
  else console.error('[chatbot] failed:', (err as Error)?.message ?? err);
  return 'Sorry, I cannot answer right now. Please message us on WhatsApp or use the enquiry form at /contact#enquire.';
}

chatbotRouter.post(
  '/',
  requireWebsite,
  limitByIp('chat-burst', 12, 60_000, 'You are sending messages very quickly. Please wait a minute.'),
  asyncHandler(async (req, res) => {
    if (!env.OPENAI_API_KEY) throw new HttpError(503, 'The chat assistant is not switched on.');
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
    const conversation: OpenAI.Chat.ChatCompletionMessageParam[] = [
      // Stable instructions + studio facts first (cached by OpenAI); the clock comes after them.
      { role: 'system', content: systemPrompt(current, settings) },
      {
        role: 'system',
        content: `Current date and time at the studio: ${new Date().toLocaleString('en-IN', { timeZone: env.BUSINESS_TIMEZONE, dateStyle: 'full', timeStyle: 'short' })}.`,
      },
      ...history.map((m) => ({ role: m.role, content: m.content })),
    ];
    const visitorMessages = history.filter((m) => m.role === 'user').map((m) => m.content);

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
    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const stream = await openai().chat.completions.create(
          {
            model: env.OPENAI_MODEL,
            messages: conversation,
            tools: leadSaved ? undefined : [SAVE_ENQUIRY],
            parallel_tool_calls: leadSaved ? undefined : false,
            max_completion_tokens: MAX_REPLY_TOKENS,
            prompt_cache_key: 'moksha-website-chatbot',
            stream: true,
            stream_options: { include_usage: true },
          },
          { signal: abort.signal },
        );

        let text = '';
        let finish: string | null = null;
        const calls: { id: string; name: string; args: string }[] = [];
        for await (const chunk of stream) {
          if (chunk.usage) {
            const u = chunk.usage;
            console.info(`[chatbot] tokens in=${u.prompt_tokens} cached=${u.prompt_tokens_details?.cached_tokens ?? 0} out=${u.completion_tokens}`);
          }
          const choice = chunk.choices[0];
          if (!choice) continue;
          if (choice.delta.content) {
            text += choice.delta.content;
            send(res, { t: 'text', v: choice.delta.content });
          }
          for (const tc of choice.delta.tool_calls ?? []) {
            const call = (calls[tc.index] ??= { id: '', name: '', args: '' });
            if (tc.id) call.id = tc.id;
            if (tc.function?.name) call.name += tc.function.name;
            if (tc.function?.arguments) call.args += tc.function.arguments;
          }
          if (choice.finish_reason) finish = choice.finish_reason;
        }

        const toolCalls = calls.filter(Boolean);
        if (finish !== 'tool_calls' || !toolCalls.length) break;

        conversation.push({
          role: 'assistant',
          content: text || null,
          tool_calls: toolCalls.map((c) => ({
            id: c.id,
            type: 'function' as const,
            function: { name: c.name, arguments: c.args },
          })),
        });
        for (const call of toolCalls) {
          let result: ToolResult;
          if (call.name !== 'save_enquiry') result = { ok: false, error: `Unknown tool ${call.name}` };
          else {
            try {
              result = await saveEnquiry(call.args, ip, visitorMessages);
            } catch (err) {
              console.error('[chatbot] could not save the enquiry:', (err as Error).message);
              result = {
                ok: false,
                error: 'The enquiry could not be saved. Give the visitor the WhatsApp number or /contact#enquire instead.',
              };
            }
          }
          if (result.ok) {
            leadSaved = true;
            send(res, { t: 'saved' });
          }
          conversation.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(result),
          });
        }
        if (text) send(res, { t: 'text', v: '\n\n' });
      }
      send(res, { t: 'done' });
    } catch (err) {
      if (!abort.signal.aborted) send(res, { t: 'error', v: describeFailure(err) });
    } finally {
      res.end();
    }
  }),
);
