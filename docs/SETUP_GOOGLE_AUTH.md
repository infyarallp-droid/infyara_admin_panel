# "Continue with Google" — setup guide

| | |
|---|---|
| **Already built** | Google sign-in and sign-up (OAuth 2.0 authorization code + PKCE on the website; the API independently verifies Google's ID token signature, issuer and audience), the mandatory mobile-number step for new Google users, connecting/disconnecting Google from account settings |
| **You need** | A Google account to own the Google Cloud project (ideally the studio's) |
| **Cost** | Free |

The **Continue with Google** button stays hidden until the keys below are set; mobile + password
sign-in works without it.

## How it works

1. The visitor clicks **Continue with Google** → Google → back to the website.
2. **Returning user** (Google already linked to an account) → signed in.
3. **New user** → asked for their **mobile number** (mandatory) → the account is created only then.
   If that mobile already has an account, the visitor is told to sign in with mobile + password and
   connect Google from *Account settings* — accounts are never merged on an unverified number.
   The same applies when the Google email is already the sign-in email of another account.
4. Every new account appears on the admin **Website Logins** page.

## 🧑 1. Google Cloud project and consent screen

1. **console.cloud.google.com** → project picker → **New project** → name *Moksha Wellness Website*.
2. **APIs & Services → OAuth consent screen** (newer consoles: **Google Auth Platform → Branding**):
   - App name: *Moksha Wellness*; user support email: the studio email; logo: `public/logo-mark.png` (optional, requires brand verification).
   - App domain / homepage: `https://www.mokshawellness.in`; privacy policy: `https://www.mokshawellness.in/privacy`; terms: `https://www.mokshawellness.in/terms` (publish those pages first).
   - Authorised domains: `mokshawellness.in`.
   - Developer contact email.
3. **Audience**: *External*.
4. **Data access / Scopes**: `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` — basic scopes, no Google security review needed.
5. While in **Testing**, only the test users you add can sign in. When ready, **Publish app → In production** (no review is needed for these basic scopes; if you uploaded a logo, Google verifies the brand first, usually in a few days).

## 🧑 2. OAuth client

1. **APIs & Services → Credentials** (or **Google Auth Platform → Clients**) → **Create credentials → OAuth client ID**.
2. Application type: **Web application**; name: *Moksha website*.
3. **Authorised JavaScript origins**:
   - `https://www.mokshawellness.in`
   - `http://localhost:3000` (local development)
4. **Authorised redirect URIs** (must match exactly):
   - `https://www.mokshawellness.in/api/auth/google/callback`
   - `http://localhost:3000/api/auth/google/callback`
   - Add your Vercel preview domain too if you test there, e.g. `https://moksha-website.vercel.app/api/auth/google/callback`.
5. **Create** → copy the **Client ID** and **Client secret**.

## 3. Connect

| Where | Variable | Value |
|---|---|---|
| Website (Vercel → Settings → Environment Variables) | `GOOGLE_CLIENT_ID` | Client ID |
| Website | `GOOGLE_CLIENT_SECRET` | Client secret (server-only — no `NEXT_PUBLIC_` prefix) |
| Website | `NEXT_PUBLIC_SITE_URL` | `https://www.mokshawellness.in` (used to build the redirect URI) |
| Admin API (Render) | `GOOGLE_CLIENT_ID` | the **same** Client ID (the API checks tokens were issued for it) |

Redeploy both.

## 4. Test

1. Website → **Sign in** → **Continue with Google** → pick a Google account.
2. First time: you land on **One last step** → enter a mobile number → **My account** opens.
3. Admin → **Website Logins**: the account shows *Signed up with Google* and the sign-in history.
4. Sign out → **Continue with Google** again → straight into *My account*.
5. With a mobile+password account: *Account settings → Connect Google* → afterwards both sign-in methods work.
6. Try a mobile number that already has an account during step 2 → you are asked to sign in with it instead (no merge).

## Troubleshooting

| Symptom | Fix |
|---|---|
| Google shows `redirect_uri_mismatch` | The redirect URI in Google Cloud must be exactly `<NEXT_PUBLIC_SITE_URL>/api/auth/google/callback` (scheme, `www`, no trailing slash). |
| "Google sign-in could not be verified" | `GOOGLE_CLIENT_ID` on the API differs from the website's. |
| `Access blocked: app has not completed verification` / only some users can sign in | App is still in *Testing* — add test users or publish to production. |
| "That sign-in took too long or was opened in another browser" | The sign-in started in one browser/tab and finished in another, or after 10 minutes. Start again. |
| Button not visible | `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` missing on the website. |
