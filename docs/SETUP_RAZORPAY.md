# Razorpay — online payments setup guide

**Why Razorpay:** built for Indian businesses — INR settlement, UPI, RuPay/Visa/Mastercard cards,
netbanking and wallets in one checkout, simple onboarding, and refunds from the same dashboard.
Stripe stopped onboarding new Indian businesses for domestic payments in 2024 (invite-only), and
does not support UPI as broadly. Only Razorpay is integrated.

| | |
|---|---|
| **Already built** | Server-side orders with server-computed amounts, Razorpay Checkout, signature + gateway verification, idempotent webhooks, recovery of abandoned checkouts, receipts on the existing invoices, online plan purchase (creates the enrolment), refunds, admin *Online Payments* dashboard, student payment history |
| **For the demo (today)** | A free Razorpay account in **Test mode** — no KYC needed (sections 1–6) |
| **For real money** | KYC / account activation (section 8), then live keys (section 9) |

Steps marked 🧑 are done in the Razorpay dashboard.

---

## 1. 🧑 Create the account (no KYC needed for test mode)

1. Go to **dashboard.razorpay.com/signup** → sign up with the studio's email and mobile (verify both).
2. Skip/postpone the activation form for now. The dashboard opens in **Test mode** (toggle at the top).

## 2. 🧑 Test API keys

1. Make sure the toggle says **Test Mode**.
2. **Account & Settings → API Keys → Generate Test Key** (older dashboards: *Settings → API Keys*).
3. Copy both values — the secret is shown **once**:
   - Key Id `rzp_test_…` → `RAZORPAY_KEY_ID`
   - Key Secret → `RAZORPAY_KEY_SECRET`

## 3. 🧑 Webhook (test mode)

Webhooks make payments reliable even if the student closes the browser right after paying.

1. **Account & Settings → Webhooks → + Add New Webhook** (still in Test mode — webhooks are set up separately for Test and Live).
2. **Webhook URL**: `https://<your-api-domain>/webhooks/razorpay`
   (must be public https — for a laptop-only demo you can skip the webhook; the payment is still verified when the browser returns, and the job runner recovers anything missed).
3. **Secret**: a long random string: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` → `RAZORPAY_WEBHOOK_SECRET`.
4. **Active events** — tick:
   `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, `refund.created`, `refund.processed`, `refund.failed`.
5. Alert email: your email. **Create Webhook**.

## 4. 🧑 Capture setting

**Account & Settings → Payment capture** → **Automatic capture** (default). The system also
captures *authorized* payments itself if this is ever turned off.

## 5. Put the keys on the server

On Render → *moksha-api* → **Environment** (server only — never in the website or admin panel code):

```
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
```

Locally, put the same three lines in the admin panel's `.env`. Restart the API.
Admin panel → **Online Payments** now shows a blue *Test mode* banner and the webhook URL.

Pay buttons appear on the website only when these keys are set.

## 6. Test payments (demo for the client)

**Choose what can be paid online:**
- **Invoices** — any unpaid/part-paid invoice of a student whose website login is linked (admin → *Website Logins*). The student sees **Pay now** in *My account*.
- **Plans** — admin → *Website → Programmes* → switch **Sell online** on a plan with a fee (Admin/Super Admin only). The plan shows **Join online** on the website with its price.

**Test card and UPI details** (Test mode only, no real money):

| Method | Details |
|---|---|
| Card (success) | `4111 1111 1111 1111` (Visa) or `5267 3181 8797 5449` (Mastercard), any future expiry, any CVV → on the bank page choose **Success** |
| Card (failure) | same card → choose **Failure** on the bank page |
| UPI (success) | UPI id `success@razorpay` |
| UPI (failure) | UPI id `failure@razorpay` |
| Netbanking | any bank → **Success** / **Failure** |

(Razorpay occasionally updates test data — see *razorpay.com/docs/payments/payments/test-card-details*.)

**Demo script:**
1. On the website: **Sign in** → *My account* → **Pay now** on an invoice (or *Classes* → **Join online**, choose a start date).
2. Pay with `success@razorpay` → the page shows **Payment successful**; *My account* shows the receipt (PDF).
3. Admin → **Online Payments**: the order is **Paid**, with method, Razorpay fee and the student. The invoice is **Paid** and has a receipt; a plan purchase also created the enrolment and the student record if new.
4. Try `failure@razorpay` → the website shows the failure and lets the student retry; admin shows **Failed**.
5. **Refund**: admin → *Online Payments* → open a paid order → **Refund…** → amount + reason. In test mode the refund is processed instantly; the invoice's paid amount drops accordingly.

**Duplicate and edge cases (all handled, all covered by automated tests):**
- The same webhook delivered twice → recorded once (event id).
- Webhook arrives before the browser returns, or the browser never returns → the payment is still applied once; the job runner checks open orders every few minutes.
- The student pays twice for the same invoice in two tabs → the second payment is flagged **Needs review** (money received but not applied) and admins are notified; refund it from the dashboard.
- Any amount the browser sends is ignored; the amount comes from the invoice/plan on the server.

To re-send a webhook manually: Razorpay dashboard → *Webhooks* → your webhook → recent deliveries → **Resend**.

## 7. What the website must show for KYC approval (already in place or one click away)

Razorpay reviews the website during activation. Make sure these are live on your domain:

- [x] Business name, logo, description of services (home, classes, training pages)
- [x] Contact details — phone, email; **add the studio address** in admin → *Page Content → Contact details & footer*
- [ ] **Privacy policy** — admin → *Page Content → Privacy policy* → review the draft → **Publish**
- [ ] **Terms & conditions** — same, *Terms & conditions*
- [ ] **Cancellation & refund policy** — same, *Cancellation & refund policy*
- [ ] **Prices** — switch *Sell online* on for the plans you sell (the fee is then shown publicly)

The three policy drafts are suggestions — read and adjust them (ideally with a professional) so
they match how the studio really works; once published they are the studio's binding policies.

## 8. 🧑 KYC / account activation (for live payments)

Dashboard → **Activate account** (or *Account & Settings → Business details*). Typical requirements:

| Business type | Documents |
|---|---|
| **Proprietorship** | Owner's PAN; owner's Aadhaar (for e-KYC); one business proof: GST certificate **or** Udyam/MSME **or** Shop & Establishment licence; bank account in the business or proprietor's name |
| **Partnership / LLP** | Firm PAN; partnership deed / LLP agreement; certificate of incorporation (LLP); PAN + Aadhaar of signatory; GST (if registered) |
| **Private Ltd** | Company PAN, certificate of incorporation, MoA/AoA, director PAN/Aadhaar, board resolution if requested |

Plus in all cases:
- **Bank account** for settlements: account number + IFSC; a cancelled cheque or bank statement.
- **Website**: `https://www.mokshawellness.in` with the items in section 7.
- **Business category**: *Education / Coaching* or *Health & Fitness* (choose what matches the studio's registration).
- **Expected monthly volume** and average ticket size.

Approval usually takes **2–7 working days**. Razorpay may ask for clarification by email — reply
from the registered email. A small penny-drop deposit verifies the bank account.

## 9. 🧑 Switch to live payments

1. After activation, toggle **Live Mode** → **Account & Settings → API Keys → Generate Live Key** (`rzp_live_…` + secret).
2. **Webhooks** (in Live mode) → add the same URL, a **new** secret, the same events.
3. Render → *moksha-api* → replace `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` with the live values → save (redeploys).
4. Admin → *Online Payments* shows a green **Live mode** banner.
5. Make one real ₹1–₹10 payment yourself (e.g. a test plan priced ₹1, switched off again afterwards), check it in admin and in the Razorpay dashboard, then **refund** it from the admin panel.
6. Keep the test keys in a safe place — you can switch back to test mode any time by restoring them.

## 10. Settlements, fees and refunds

- **Fees**: Razorpay's standard plan is about **2% per transaction** (+18% GST on the fee); domestic UPI is often cheaper; international/Amex/corporate cards cost more. Confirm on *razorpay.com/pricing* — fees can be negotiated at higher volumes. The admin order detail shows the exact fee for each payment.
- **Settlements**: to the registered bank account, by default **T+2 working days**. See *Razorpay → Settlements*; match them to *Online Payments* using the payment ids.
- **Refunds**: started from the admin panel (*Online Payments → order → Refund…*, roles Super Admin / Admin / Accountant). Money returns to the original method in 5–7 working days. Refunds made directly in the Razorpay dashboard are also picked up by the webhook and reflected on the invoice.
- Razorpay's fee on the original payment is **not** returned on refunds.

## 11. Verify in production

- [ ] `/health` OK, *Online Payments* shows **Live mode** and *webhook secret set*.
- [ ] Real ₹1 payment → order **Paid**, invoice **Paid**, receipt PDF opens for the student.
- [ ] Razorpay → *Webhooks → deliveries* shows 200 responses.
- [ ] Refund of that payment → **Processed** in both places.
- [ ] Next day: the settlement appears in Razorpay and in the bank.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| No **Pay now** buttons on the website | Keys not set on the API, or the student's login is not linked to a student record (invoices), or no plan has *Sell online* on (plans). |
| "Payment gateway error: Authentication failed" | Wrong key id/secret pair, or test key with live secret. |
| Checkout window does not open | Browser extension blocking `checkout.razorpay.com`; or the website's CSP was changed — it must allow `https://checkout.razorpay.com` and `https://*.razorpay.com`. |
| Paid, but the website keeps "Confirming…" | The browser verification failed and the webhook is not configured/failing. Check *Razorpay → Webhooks → deliveries* and the API logs; admin can press **Refresh from Razorpay** on the order. |
| Webhook deliveries show 400 | `RAZORPAY_WEBHOOK_SECRET` on the server differs from the secret in the dashboard (each mode has its own). |
| Order **Needs review** | Money received but could not be applied (invoice already paid another way, plan fee changed, overlapping enrolment, or an unlinked existing student record). Refund it, or record it manually and note the Razorpay payment id. |
| Refund **Failed** | Usually insufficient balance in the Razorpay account for instant refunds; retry after the next settlement, or contact Razorpay support. |
