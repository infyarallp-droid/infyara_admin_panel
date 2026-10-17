# Website AI chatbot (OpenAI)

A chat button ("Ask us") at the bottom-left of every website page. Visitors ask about classes,
programmes, plans and timings; the assistant answers from your admin panel content, and when a
visitor wants to join it collects their name and mobile number **with their permission** and saves
them as a lead (Leads inbox, source *Website*, form *website-chatbot*).

The chat button appears only when **both** are true:

1. `OPENAI_API_KEY` is set on the API server (Render).
2. *Website → Page Content → AI chatbot → Chatbot on the website* is **On** (the default).

## 1. Create an OpenAI API key

A ChatGPT Plus subscription does **not** include API use — the API is billed separately, pay-as-you-go.

1. Go to <https://platform.openai.com> and sign in (or create an account).
2. **Settings → Billing** → add a payment method and some credit (e.g. $5–10 to start).
   Optional but recommended: **Settings → Limits** → set a monthly budget.
3. **API keys → Create new secret key** → name it `moksha-website-chatbot` → copy it (starts with `sk-`).
   Keep it secret: never paste it in chat, email or the website code.

## 2. Add it to Render (the API server)

Render → `moksha-api` service → **Environment** → add:

| Key | Value |
| --- | --- |
| `OPENAI_API_KEY` | the `sk-…` key |
| `OPENAI_MODEL` | `gpt-4.1-mini` (default; fast and inexpensive). Any chat model your OpenAI account can use works, e.g. `gpt-5.4-mini`. |
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
- If OpenAI is down, the key is wrong, or credit runs out, visitors see a polite message pointing
  to WhatsApp and the enquiry form. The reason is written to the Render log (`[chatbot] …`).

## 5. Cost

Each reply sends the instructions and studio facts (a few thousand tokens; OpenAI caches the
repeated part automatically) and gets a short answer back. With `gpt-4.1-mini` that is a small
fraction of a rupee per reply — check current prices at <https://openai.com/api/pricing>.
The daily limits above cap the worst case, and each reply's token use is logged on Render as
`[chatbot] tokens in=… cached=… out=…`. OpenAI's **Usage** page shows the actual spend.

## Troubleshooting

| Render log | Fix |
| --- | --- |
| `OPENAI_API_KEY was rejected` | Key copied wrongly or revoked — create a new one |
| `rate limit or quota reached` | Add credit in OpenAI Billing, or raise the account's limits |
| `does not know the model` | Fix `OPENAI_MODEL` (or remove it to use the default) |
| `daily limit … reached` | Expected protection; raise `CHATBOT_DAILY_LIMIT` if genuine traffic |

No chat button? Check `https://<api>/api/public/site` shows `"chatbotAvailable": true`, and that
the AI chatbot section is published with "On".
