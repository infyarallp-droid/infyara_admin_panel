# WhatsApp Business Platform — setup guide

How to connect the admin panel's **WhatsApp** module to Meta's official WhatsApp Business
Platform (Cloud API). Allow **3–10 days** in total: business verification and template approval
are done by Meta and cannot be hurried.

| | |
|---|---|
| **Already built** | Sending engine, opt-in ledger (sign-up, staff, STOP/START replies), templates (sync or manual), send-now / scheduled sends, automatic reminder rules, delivery receipts, retries, message history, webhook with signature check |
| **You need** | A Facebook account, the studio's business documents, a phone number for WhatsApp Business, a payment card for Meta billing |
| **You do in Meta's dashboards** | Steps 1–7 and 10 below (marked 🧑) |
| **You do on the server** | Step 8 (environment variables) |

---

## 1. 🧑 Meta Business account and business verification

1. Go to **business.facebook.com** → **Create account**. Use the studio's legal name exactly as on its documents (e.g. *Moksha Wellness*), and an email you will keep.
2. **Settings** (gear icon) → **Business info** → fill in legal name, address, phone, website (`https://www.mokshawellness.in`). The website must be live and show the same business name and contact details.
3. **Security centre** (or **Business info → Business verification**) → **Start verification**.
4. Choose the country **India** and upload **one** document showing the legal name and address, for example:
   - GST registration certificate, **or**
   - Udyam (MSME) registration certificate, **or**
   - Shop & Establishment licence, **or**
   - for a proprietorship: a utility bill / bank statement in the business name.
5. Confirm by the method offered (email to a domain address, phone call or SMS).
6. Wait for **Verified** (usually 1–5 working days). If rejected, Meta says why — the most common cause is the legal name differing between the document, the website and the form.

> You can do steps 2–5 of section 3 (test number) while verification is pending.

## 2. 🧑 Create the Meta developer app

1. Go to **developers.facebook.com** → log in with the same Facebook account → **My Apps → Create app**.
2. Use case: **Other** → app type **Business** → name *Moksha Wellness WhatsApp* → choose your business portfolio from step 1.
3. On the app dashboard, find **WhatsApp** → **Set up**. Meta creates a **WhatsApp Business Account (WABA)** and a free **test phone number**.
4. **App settings → Basic**:
   - Add the **Privacy policy URL**: `https://www.mokshawellness.in/privacy` (publish that page first in admin → *Page Content → Privacy policy*).
   - Copy the **App secret** (click *Show*) → this is `WHATSAPP_APP_SECRET`.

## 3. 🧑 Add the studio's phone number

1. App dashboard → **WhatsApp → API Setup → Add phone number**.
2. Use a number that is **not** currently registered on the WhatsApp or WhatsApp Business **app**. (To reuse an existing number, delete its WhatsApp account in the phone app first — chat history is lost.) A landline works if it can receive an SMS or voice call.
3. Enter the **display name** (*Moksha Wellness*) — it must match the business name; Meta reviews it (hours to 2 days).
4. Verify the number with the code Meta sends.
5. Copy the **Phone number ID** (not the phone number itself) shown under the number → `WHATSAPP_PHONE_NUMBER_ID`.
6. Copy the **WhatsApp Business Account ID** (top of API Setup) → `WHATSAPP_BUSINESS_ACCOUNT_ID` (used by *Sync templates from Meta*).

## 4. 🧑 Permanent access token (System User)

The token on the API Setup page expires in 24 hours. For the server you need a permanent one:

1. **business.facebook.com → Settings → Users → System users → Add**. Name *moksha-api*, role **Admin**.
2. **Assign assets** → **Apps** → your app → **Full control**; **WhatsApp accounts** → your WABA → **Full control**.
3. **Generate token** → app: your app → expiry **Never** → permissions:
   `whatsapp_business_messaging`, `whatsapp_business_management`.
4. Copy the token **now** (it is shown once) → `WHATSAPP_ACCESS_TOKEN`. Store it in your password manager; never paste it into chat, email or code.

## 5. 🧑 Payment method (required for sending)

**business.facebook.com → Settings → Billing & payments → WhatsApp accounts** → add a card for
the WABA. Without it, template messages fail with an "account not eligible" error.

## 6. 🧑 Create message templates

Businesses may start a conversation only with a template Meta has approved.
**WhatsApp Manager** (business.facebook.com → *WhatsApp accounts → WhatsApp Manager*) → **Message templates → Create template**.

Suggested templates (category **Utility**, language **English**):

| Name | Body | Used for |
|---|---|---|
| `renewal_reminder` | `Hi {{1}}, your {{2}} at Moksha Wellness ends on {{3}}. Reply here or visit the studio to renew.` | Renewal rule / built-in reminder |
| `class_reminder` | `Hi {{1}}, a reminder that your {{2}} starts on {{3}}. See you on the mat!` | Class reminder rule |
| `payment_due` | `Hi {{1}}, invoice {{2}} has a balance of Rs. {{3}}. You can pay online from your Moksha Wellness account.` | Payment reminder rule |
| `payment_received` | `Hi {{1}}, we received Rs. {{2}} for invoice {{3}}. Thank you!` | Payment confirmation rule |
| `enrollment_confirmed` | `Hi {{1}}, you are enrolled in {{2}} from {{3}}. Welcome to Moksha Wellness!` | Enrolment confirmation rule |
| `studio_update` (category **Marketing**) | `Hi {{1}}, {{2}}` | Announcements to opted-in students |

Tips: add a sample value for every `{{n}}` when Meta asks; avoid promotional words in Utility
templates (Meta re-categorises them as Marketing). Approval takes minutes to 24 hours.

## 7. 🧑 Webhook (delivery receipts and STOP replies)

1. App dashboard → **WhatsApp → Configuration → Webhook → Edit**.
2. **Callback URL**: `https://<your-api-domain>/webhooks/whatsapp`
3. **Verify token**: invent a long random string (e.g. `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`) → this is `WHATSAPP_VERIFY_TOKEN`. Set it on the server **before** clicking *Verify and save* (step 8).
4. **Webhook fields → messages → Subscribe**. This delivers sent/delivered/read/failed receipts and incoming messages (incoming messages become **Leads**; "STOP"/"START" change the sender's opt-in).

## 8. Connect the credentials to the server

On Render → *moksha-api* → **Environment** (never in code or the website):

| Variable | Value |
|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | step 3.5 |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | step 3.6 |
| `WHATSAPP_ACCESS_TOKEN` | step 4 |
| `WHATSAPP_APP_SECRET` | step 2.4 |
| `WHATSAPP_VERIFY_TOKEN` | step 7.3 |
| `WHATSAPP_REQUIRE_CONSENT` | `true` (keep it) |

Save → the service redeploys. In production the API refuses to start if the token is set without the
app secret, so webhooks can never be accepted unsigned.

## 9. Test it

1. Admin panel → **WhatsApp → Overview**: the checklist should show *credentials* and *webhook secured* ticked.
2. **Templates → Sync from Meta** → your approved templates appear with status *approved*.
3. **Opt-ins** → find a test student whose mobile is **your own phone** → *Record opt-in* (note: "Test, my own number").
4. **Send / schedule** → choose `renewal_reminder` (or any approved template) → fill the values (try `{name}`) → select yourself → **Send**.
5. Your phone receives the message. In **History** the status moves *Sent → Delivered → Read* within seconds (that proves the webhook works).
6. Reply **STOP** from your phone → **Opt-ins** shows *Opted out*; sending again is skipped as *No opt-in*. Reply **START** to opt back in.
7. Schedule a message 10 minutes ahead → it is sent by the job runner (see DEPLOYMENT.md → *Job runner*). If it stays *Scheduled*, the scheduler is not calling the API.

While the app is in **Development** mode, Meta only delivers to up to 5 numbers you add under
*API Setup → To*. That is fine for testing.

## 10. 🧑 Switch to production

1. Business verification ✅, display name approved ✅, payment method ✅.
2. App dashboard → **App mode: Live** (top bar). Live mode needs the privacy-policy URL (step 2.4).
3. New numbers start with a messaging limit of **250 business-initiated conversations per 24 h**; Meta raises it automatically (1K → 10K → 100K) as quality stays high.
4. Watch **WhatsApp Manager → Insights → Quality rating**. If people block or report messages, the rating drops and Meta may limit or pause the number or templates.

## Charges (approximate — confirm on Meta's current rate card)

Since July 2025 Meta charges **per delivered template message**, by category and country. Indicative India rates:

| Category | Approx. per message |
|---|---|
| Marketing | ₹0.80–0.90 |
| Utility (reminders, confirmations) | ₹0.12–0.15, and **free** when sent within 24 h of the student messaging you |
| Authentication | ₹0.12–0.15 |
| Replies to the student within their 24 h window (non-template) | free |

Rates change; see *developers.facebook.com/docs/whatsapp/pricing*. There is no charge from this
system — only Meta's. Studio-scale usage (a few hundred reminders a month) is typically under ₹200/month.

## Rules the system enforces for you

- Messages go only to numbers with a recorded **opt-in** (website sign-up checkbox, account settings, staff-recorded consent with a note, or a START reply). Every change is kept with who/when/how.
- **STOP** replies opt the person out immediately.
- The same reminder is never sent twice (unique key per student + event + date).
- Only **approved** templates can be selected; the number of values must match the template.
- Failed sends retry automatically with back-off (temporary errors only); staff can retry the rest from *History*.

**Your responsibility:** only record an opt-in a student actually gave, and do not use WhatsApp
for unsolicited promotion. Meta can restrict the business number if people report messages.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Status *WhatsApp not set up* | `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_ACCESS_TOKEN` missing on the server. Messages wait in the queue and go out once added. |
| *No opt-in* | The student has no recorded consent. Record it (Opt-ins tab) only if they agreed. |
| Error `(#132001) Template name does not exist in the translation` | Name or **language** differs from Meta's (e.g. `en` vs `en_US`). Sync templates or fix the manual entry. |
| Error `(#132000) Number of parameters does not match` | The template in Meta has a different number of `{{n}}` than the rule/send. Re-sync templates. |
| Error `(#131030) Recipient phone number not in allowed list` | App is in Development mode — add the number under *API Setup → To*, or switch to Live. |
| Error `(#131042) Business eligibility payment issue` | Add a payment method (step 5). |
| Error `(#190) Access token has expired` | You used the temporary token — create the System User token (step 4). |
| Error `(#131047) Re-engagement message` | Free-form text outside the 24 h window — only templates can be sent; this system always uses templates. |
| Status stays *Sent*, never *Delivered* | Webhook not subscribed to **messages**, wrong callback URL, or `WHATSAPP_APP_SECRET` wrong (API answers 401 — see Render logs). |
| Webhook verification fails in Meta | `WHATSAPP_VERIFY_TOKEN` on the server differs from what you typed, or the API was asleep — open `/health` first, then retry. |
| Scheduled messages never send | The job runner is not being called — see DEPLOYMENT.md → *Job runner*, and *Audit Log & Jobs* in the admin panel for the last run time. |
