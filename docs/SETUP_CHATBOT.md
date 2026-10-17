# Website AI chatbot (Claude)

A chat button ("Ask us") at the bottom-left of every website page, powered by Anthropic's Claude.
Visitors ask about classes, programmes, plans and timings; the assistant answers from your admin
panel content, and when a visitor wants to join it collects their name and mobile number **with
their permission** and saves them as a lead (Leads inbox, source *Website*, form *website-chatbot*).

The chat button appears only when **both** are true:

1. `ANTHROPIC_API_KEY` is set on the API server (Render).
2. *Website → Page Content → AI chatbot → Chatbot on the website* is **On** (the default).

## 1. Create an Anthropic API key

A Claude.ai (Pro/Max) subscription does **not** include API use — the API is billed separately, pay-as-you-go.

1. Go to <https://console.anthropic.com> and sign in (or create an account).
2. **Settings → Billing** → add a payment method and some credit (e.g. $10 to start).
   Optional but recommended: **Settings → Limits** → set a monthly spend limit.
3. **API keys → Create key** → name it `moksha-website-chatbot` → copy it (starts with `sk-ant-`).
   Keep it secret: never paste it in chat, email or the website code.

## 2. Add it to Render (the API server)

Render → `moksha-api` service → **Environment** → add:

| Key | Value |
| --- | --- |
| `ANTHROPIC_API_KEY` | the `sk-ant-…` key |
| `CHATBOT_MODEL` | optional, default `claude-opus-5-5` (Claude Opus 5.5 — the most capable). `claude-sonnet-5-5` or `claude-haiku-5-5` cost less (see Cost). |
| `CHATBOT_EFFORT` | optional, default `low` — how much Claude thinks before answering. `low` is quick and right for chat; `medium` for more careful answers. |
| `CHATBOT_DAILY_LIMIT` | optional, default `500` replies per day for the whole website |
| `CHATBOT_VISITOR_DAILY_LIMIT` | optional, default `40` replies per visitor per day |

Save → Render redeploys. Nothing is needed on Vercel: the website already talks to the API with
`ADMIN_API_URL` and `WEBSITE_SERVICE_KEY`. The website refreshes its content within 5 minutes (or
publish any content section to refresh it straight away), and the chat button appears.

## 3. Teach and control it — admin panel

**Website → Page Content → AI chatbot** (Save draft → Publish):

| Field | What it does |
| --- | --- |
| Chatbot on the website | On / Off — hide the button at any time without touching Render |
| Assistant name | Shown at the top of the chat window |
| First message | The greeting |
| Suggested questions | Up to 6 buttons visitors can tap |
| Extra facts for the assistant | Anything not on the website: batch timings, fees, offers, what to bring, parking, languages… |
| Extra instructions | How it should behave, e.g. "Always suggest a trial class" |

The extra facts and instructions are sent only to the assistant — they are not shown in the
website's public data.

Everything else is read automatically and stays up to date when you publish changes:
programmes (with summaries and online plans/fees), FAQs, team, announcements, contact details,
address, hours and social links.

## 4. What it will and won't do

- Answers only from your content; if a detail is missing it says so and offers to pass the
  visitor's details to the team, or gives the WhatsApp number.
- Replies in the visitor's language (English, Hindi, Telugu, …).
- No medical advice: for injuries, conditions or pregnancy it suggests checking with a doctor and
  mentions the health declaration.
- Saves a lead only after the visitor agrees, with a valid 10-digit Indian mobile number; at most
  3 leads per hour from one device.
- If Anthropic is unavailable, the key is wrong, or credit runs out, visitors see a polite message
  pointing to WhatsApp and the enquiry form. The reason is written to the Render log (`[chatbot] …`).

## 5. Cost

Each reply sends the instructions and studio facts (a few thousand tokens — **prompt-cached**, so
repeat reads cost about a tenth) plus the conversation, and gets a short answer back.
Approximate prices per million tokens (check <https://www.anthropic.com/pricing>):

| `CHATBOT_MODEL` | Input | Cached input | Output | Rough cost per reply |
| --- | --- | --- | --- | --- |
| `claude-opus-5-5` (default) | $4 | $0.20 | $20 | ~₹0.5–1 |
| `claude-sonnet-5-5` | $2 | $0.20 | $10 | ~₹0.3–0.5 |
| `claude-haiku-5-5` | $0.10 | — | $0.50 | a few paise |

The daily limits cap the worst case (500 replies/day on Opus ≈ a few dollars at most). Each reply's
usage is logged on Render as `[chatbot] model=… tokens in=… cache_read=… out=…`; the Anthropic
Console's **Usage** page shows the actual spend.

## Troubleshooting

| Render log | Fix |
| --- | --- |
| `ANTHROPIC_API_KEY was rejected` | Key copied wrongly or revoked — create a new one |
| `rejected the request … credit` | Add credit in Console → Billing |
| `rate limit reached` | Temporary; raise limits in the Console if it keeps happening |
| `does not know the model` | Fix `CHATBOT_MODEL` (or remove it to use the default) |
| `daily limit … reached` | Expected protection; raise `CHATBOT_DAILY_LIMIT` if genuine traffic |

No chat button? Check `https://<api>/api/public/site` shows `"chatbotAvailable": true`, and that
the AI chatbot section is published with "On".
