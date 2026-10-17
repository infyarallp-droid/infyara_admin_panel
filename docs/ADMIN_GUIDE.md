# Admin panel guide — website, logins, WhatsApp and online payments

For studio staff. The original modules (Students, Courses, Invoices, Renewals, Leads, Inventory,
Employees, Consent) work as before; this guide covers what is new.

**Who can do what**

| Area | Super Admin | Admin | Manager | Front desk | Accountant | Trainer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Website Logins — view | ✓ | ✓ | ✓ | ✓ | | |
| Website Logins — link, suspend, reset password | ✓ | ✓ | ✓ | | | |
| Website content, Team, Testimonials, FAQs, Announcements, Gallery, Programmes | ✓ | ✓ | ✓ | | | |
| Switch "Sell online" on a plan | ✓ | ✓ | | | | |
| WhatsApp module | ✓ | ✓ | ✓ | | | |
| Online Payments — view | ✓ | ✓ | ✓ | | ✓ | |
| Refunds | ✓ | ✓ | | | ✓ | |
| Audit log & jobs | ✓ | ✓ | | | | |

Every sensitive action (publishing, linking, refunds, consent changes, suspensions, password resets)
is recorded in **Audit Log & Jobs** with who and when.

---

## Website Logins

Everyone who creates an account or signs in on the website appears here automatically — staff do not create website logins. Students sign up and sign in with their **mobile number or email** (plus password) or with **Google**; every account has a mobile number, whichever way they sign up. The *Signed up with* column shows Mobile, Email or Google, and you can filter by it.

- **Stats**: total accounts, accounts waiting to be linked, new this week, sign-ins this week.
- **Recent sign-in activity** tab: every sign-in, sign-up and failed attempt, with device and time.
- Click a row for the details: sign-in history, devices signed in, online payments, WhatsApp consent history.

**Linking an account to a student (important).** Mobile numbers typed on the website are not
verified, so a website account is never attached to a studio student automatically. When a student
signs up:
1. Open their row. If a studio student has the **same mobile**, you see *Same mobile as …* → check it is the same person (call or ask at the desk) → **Link to this student**.
2. Otherwise search by name/mobile/student ID and **Link**.
3. Once linked, the student sees their classes, invoices, receipts and can pay online in *My account*.

Other actions: **Unlink**, **Reset password** (gives a temporary password shown once — share it
privately; they must change it at next sign-in), **Sign out everywhere**, **Suspend / Reactivate**.

Students who forget their password: use **Reset password** here.

## Website → Page Content

Every text block of the website, grouped by page (home hero, ways to practise, steps, closing
call-to-action, About, Classes, Teacher training, Contact, Team/Stories/Gallery page headings,
contact details & footer, and the three policy pages).

1. Pick a section on the left. The form starts from what the website shows today.
2. Edit → **Save draft** (not live) → **Preview** opens the real website showing your draft (yellow "Preview" bar; *Exit preview* to leave).
3. **Publish** → live within seconds.
4. **Discard draft** goes back to the live version.

Lists (cards, steps, values, opening hours) have **+ Add**, **↑ ↓** to reorder and **Remove**. Empty
lists hide that part of the page. Links accept a page path (`/contact`) or a full `https://` link.

**Contact details & footer** holds phone, WhatsApp number (shows the floating WhatsApp button),
email, address, Google Maps link, opening hours and social links.

**Policy pages** (privacy, terms, cancellation & refund) come with suggested drafts. They appear on
the website and in the footer only after you publish them. Review them carefully first.

## Website → Programmes

The website's class and training cards come from the **course catalogue** (Courses page).
- **Edit website details**: show/hide on the website, summary, who it is for, order, card image.
- **Sell online** (per plan, Admin/Super Admin): shows the fee on the website with a **Join online** button. Students pay by Razorpay; their enrolment, invoice and receipt are created automatically, and you get a notification. Assign their class timing afterwards from the student's profile.

## Website → Team

Public profiles for the Team page (separate from HR records — no private data is published).
**+ Add team member** → photo (upload or pick from the library), name, title, short description,
optional biography, specialisation, experience, qualifications, social links → *Visibility*:
Draft / Published / Archived. Use ↑ ↓ to set the order. **Preview team page** shows drafts.
Archive to hide; delete (from *Show archived*) to remove permanently.

## Website → Testimonials

Written and video feedback from students.
- **Video**: a **YouTube or Vimeo link** (recommended — unlisted videos are fine, fast for visitors) or an uploaded MP4/WebM up to 50 MB. Add a thumbnail, or YouTube's is used.
- **Consent (required)**: tick only what the student agreed to — show their *name*, *photo*, *video* — and note how they agreed (e.g. "signed release form, 14 Oct"). A testimonial cannot be published without consent for what it shows, and the website only ever displays consented items.
- **Feature on the home page**: featured testimonials appear on the home page; all published ones on the *Student Stories* page.
- Videos never autoplay; nothing loads from YouTube until a visitor presses play.

## Website → FAQs and Announcements

- **FAQs**: per page (Home, Classes, Teacher training, Contact). Reorder with ↑ ↓; drafts are hidden.
- **Announcements**: a banner at the top of every page. Optional link, start and end time (e.g. show a holiday notice only for that week).

## Website → Gallery & Media

- **Gallery page** tab: **Upload photos/videos** (several at once) → they are added published. Edit a caption, the screen-reader description and an album. The Gallery page and its menu link appear once something is published.
- **Media library** tab: every uploaded file with size and date. *Copy link*, or *Delete* (files still used on the website cannot be deleted).
- Limits: images 8 MB (JPG, PNG, WebP, GIF, AVIF), videos 50 MB (MP4, WebM, MOV). Files are checked by their content, not their name. SVG is not accepted (it can contain scripts).

## Website → AI chatbot

*Website → Page Content → AI chatbot* controls the "Ask us" chat on the website: switch it on/off, its name,
greeting, suggested questions, extra facts (timings, fees, offers…) and extra instructions. It already reads your
programmes, plans, FAQs, team and contact details. When a visitor agrees to share their name and mobile number it
creates a lead in **Leads** (form: *website-chatbot*, with the visitor's messages for context).
First-time setup (Anthropic API key on Render): *docs/SETUP_CHATBOT.md*.

## WhatsApp

See *docs/SETUP_WHATSAPP.md* to connect it first.

- **Overview**: setup checklist and counts.
- **Send / schedule**: choose an approved template, fill its values (placeholders such as `{name}`, `{course}`, `{end_date}`, `{balance}` are filled per student), pick students (only opted-in students are messaged), **Send now** or **Schedule**.
- **Automatic reminders**: rules such as *Renewal reminder 5 days before an enrolment ends*, *Class reminder 1 day before start*, *Payment reminder 3 days before an invoice is due* (negative = overdue), *Enrolment confirmation*, *Payment confirmation*. Switch each on/off. Each reminder goes once per student and event. Enabling a renewal rule replaces the built-in renewal reminder.
- **Templates**: *Sync from Meta*, or *Add manually* (exact name + language from Meta).
- **Opt-ins**: who may receive messages; *Record opt-in / opt-out* for selected students with a note of how they agreed. New students can also be marked as agreed on the *New student* form. Website sign-ups opt in with a checkbox; replies of **STOP**/**START** update it automatically.
- **History**: every send with status (*Scheduled, Sent, Delivered, Read, Failed, No opt-in…*); cancel scheduled sends; **Retry failed** for eligible failures.

## Online Payments

Payments made on the website through Razorpay (setup: *docs/SETUP_RAZORPAY.md*).
- Banner shows **Test mode** (no real money) or **Live mode**.
- Totals: collected, refunded, **needs review**, abandoned/failed.
- Click an order: student, what it was for, Razorpay ids, payment method, fee, refunds, link to the invoice.
- **Needs review** = money received but not applied (e.g. the invoice was paid in cash meanwhile). Refund it, or record it manually against the right invoice.
- **Refund…**: full or partial, with a reason. The invoice's paid amount is reduced to match; the money returns to the student's card/UPI/bank in 5–7 working days.
- **Check open payments now**: asks Razorpay about checkouts that were not finished (also done automatically every few minutes).

Successful online payments appear on the invoice like any other payment (mode UPI/Card/Bank, reference = Razorpay payment id) with an automatic receipt.

## Audit Log & Jobs

- **Background jobs**: last run time of the job runner (scheduled WhatsApp, automatic reminders, daily renewal check, payment recovery) and **Run now**. If it has not run for 30 minutes, the scheduler needs attention (see DEPLOYMENT.md).
- **Audit log**: filter by action (e.g. `REFUND`, `CONTENT`, `ACCOUNT`, `WA_`).
