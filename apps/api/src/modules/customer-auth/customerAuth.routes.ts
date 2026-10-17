import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { WHATSAPP_CONSENT_TEXT, customerLoginSchema, customerSignupSchema, googleCompleteSchema } from '@moksha/shared';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, HttpError } from '../../lib/http.js';
import { notify } from '../../lib/notify.js';
import { clientIp, hit, limitByIp, reset } from '../../lib/rateLimit.js';
import { hashToken } from '../../lib/tokens.js';
import { isGoogleConfigured, signGooglePending, verifyGoogleIdToken, verifyGooglePending } from '../../lib/google.js';
import { requireCustomer, requireWebsite } from '../../middleware/customerAuth.js';
import { DUMMY_HASH } from '../auth/auth.routes.js';
import { recordConsent } from '../messaging/consent.service.js';
import { createSession, presentAccount, recordLogin } from './customerAuth.service.js';

// Website sign-up / sign-in. Called only by the website's server (service key).
export const customerAuthRouter = Router();
customerAuthRouter.use(requireWebsite);

const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES_PER_MOBILE = 8;
const BCRYPT_ROUNDS = 12;

const mobileTaken = () =>
  new HttpError(409, 'An account with this mobile number already exists. Please sign in instead.', { code: 'MOBILE_TAKEN' });

function announceSignup(name: string, method: string, accountId: string) {
  notify({
    type: 'SYSTEM',
    title: `New website sign-up: ${name}`,
    body: `Signed up with ${method === 'GOOGLE' ? 'Google' : 'mobile number'}. Link to a student record on the Website Logins page.`,
    roleTarget: 'ADMIN',
    entity: 'customer_account',
    entityId: accountId,
  }).catch((e) => console.error('[customer-auth] notification failed', e));
}

customerAuthRouter.get('/config', (_req, res) => {
  res.json({ ok: true, google: isGoogleConfigured() });
});

// POST /api/customer-auth/signup — mobile number + password
customerAuthRouter.post(
  '/signup',
  limitByIp('customer-signup', 10, 60 * 60_000, 'Too many sign-ups from this connection. Please try again later.'),
  asyncHandler(async (req, res) => {
    const input = customerSignupSchema.parse(req.body);
    if (await prisma.customerAccount.findUnique({ where: { mobile: input.mobile } })) throw mobileTaken();
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

    try {
      const result = await prisma.$transaction(async (tx) => {
        const account = await tx.customerAccount.create({
          data: {
            fullName: input.fullName,
            mobile: input.mobile,
            email: input.email || null,
            passwordHash,
            signupMethod: 'MOBILE_PASSWORD',
          },
          include: { identities: true },
        });
        if (input.whatsappOptIn) {
          await recordConsent(
            { mobile: account.mobile, state: 'OPTED_IN', source: 'WEBSITE_SIGNUP', consentText: WHATSAPP_CONSENT_TEXT, accountId: account.id, ip: clientIp(req) },
            tx,
          );
        }
        await recordLogin(req, { accountId: account.id, mobile: account.mobile, method: 'MOBILE_PASSWORD', success: true, reason: 'SIGNUP' }, tx);
        const session = await createSession(account.id, req, tx);
        return { account, session };
      });
      announceSignup(result.account.fullName, 'MOBILE_PASSWORD', result.account.id);
      res.status(201).json({ ok: true, token: result.session.token, expiresAt: result.session.expiresAt, account: presentAccount(result.account) });
    } catch (err) {
      // Two simultaneous sign-ups with one number: the unique index decides.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw mobileTaken();
      throw err;
    }
  }),
);

// POST /api/customer-auth/login — mobile number + password
customerAuthRouter.post(
  '/login',
  limitByIp('customer-login', 40, WINDOW_MS),
  asyncHandler(async (req, res) => {
    const input = customerLoginSchema.parse(req.body);
    const key = `customer-login:mobile:${input.mobile}`;
    if ((await hit(key, WINDOW_MS)) > MAX_FAILURES_PER_MOBILE) {
      throw new HttpError(429, 'Too many sign-in attempts for this number. Please wait 15 minutes and try again.');
    }
    const account = await prisma.customerAccount.findUnique({ where: { mobile: input.mobile }, include: { identities: true } });
    const ok = await bcrypt.compare(input.password, account?.passwordHash ?? DUMMY_HASH);

    if (!account || !ok) {
      await recordLogin(req, { accountId: account?.id, mobile: input.mobile, method: 'MOBILE_PASSWORD', success: false, reason: 'BAD_CREDENTIALS' });
      if (account && !account.passwordHash) {
        throw new HttpError(401, 'This account signs in with Google. Use "Continue with Google".', { code: 'USE_GOOGLE' });
      }
      throw new HttpError(401, 'Mobile number or password is incorrect.');
    }
    if (account.status !== 'ACTIVE') {
      await recordLogin(req, { accountId: account.id, mobile: account.mobile, method: 'MOBILE_PASSWORD', success: false, reason: 'SUSPENDED' });
      throw new HttpError(403, 'This account is suspended. Please contact the studio.');
    }
    await reset(key);
    await recordLogin(req, { accountId: account.id, mobile: account.mobile, method: 'MOBILE_PASSWORD', success: true });
    const session = await createSession(account.id, req);
    res.json({ ok: true, token: session.token, expiresAt: session.expiresAt, account: presentAccount(account) });
  }),
);

// POST /api/customer-auth/google — verified Google ID token from the website's OAuth callback.
// Existing identity → signed in. New identity → a pending ticket; the account is only created
// once a mobile number is added (POST /google/complete), so no account can exist without one.
customerAuthRouter.post(
  '/google',
  limitByIp('customer-google', 40, WINDOW_MS),
  asyncHandler(async (req, res) => {
    const { idToken } = z.object({ idToken: z.string().min(20).max(5000) }).parse(req.body);
    const profile = await verifyGoogleIdToken(idToken);
    const identity = await prisma.authIdentity.findUnique({
      where: { provider_subject: { provider: 'GOOGLE', subject: profile.sub } },
      include: { account: { include: { identities: true } } },
    });
    if (identity) {
      const account = identity.account;
      if (account.status !== 'ACTIVE') {
        await recordLogin(req, { accountId: account.id, mobile: account.mobile, method: 'GOOGLE', success: false, reason: 'SUSPENDED' });
        throw new HttpError(403, 'This account is suspended. Please contact the studio.');
      }
      await recordLogin(req, { accountId: account.id, mobile: account.mobile, method: 'GOOGLE', success: true });
      const session = await createSession(account.id, req);
      return res.json({ ok: true, status: 'SIGNED_IN', token: session.token, expiresAt: session.expiresAt, account: presentAccount(account) });
    }
    res.json({
      ok: true,
      status: 'NEEDS_MOBILE',
      pendingToken: await signGooglePending(profile),
      profile: { name: profile.name, email: profile.email },
    });
  }),
);

// POST /api/customer-auth/google/complete — add the mandatory mobile number and create the account.
customerAuthRouter.post(
  '/google/complete',
  limitByIp('customer-signup', 10, 60 * 60_000, 'Too many sign-ups from this connection. Please try again later.'),
  asyncHandler(async (req, res) => {
    const input = googleCompleteSchema.parse(req.body);
    const profile = await verifyGooglePending(input.pendingToken);

    const existingIdentity = await prisma.authIdentity.findUnique({
      where: { provider_subject: { provider: 'GOOGLE', subject: profile.sub } },
    });
    if (existingIdentity) throw new HttpError(409, 'This Google account is already registered. Please sign in with Google.', { code: 'GOOGLE_TAKEN' });
    // The number is not verified, so it is never used to join an existing account.
    if (await prisma.customerAccount.findUnique({ where: { mobile: input.mobile } })) {
      throw new HttpError(
        409,
        'This mobile number already has an account. Sign in with your mobile number and password, then connect Google from your account settings.',
        { code: 'MOBILE_TAKEN' },
      );
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const account = await tx.customerAccount.create({
          data: {
            fullName: input.fullName,
            mobile: input.mobile,
            email: profile.email,
            signupMethod: 'GOOGLE',
            identities: { create: { provider: 'GOOGLE', subject: profile.sub, email: profile.email } },
          },
          include: { identities: true },
        });
        if (input.whatsappOptIn) {
          await recordConsent(
            { mobile: account.mobile, state: 'OPTED_IN', source: 'WEBSITE_SIGNUP', consentText: WHATSAPP_CONSENT_TEXT, accountId: account.id, ip: clientIp(req) },
            tx,
          );
        }
        await recordLogin(req, { accountId: account.id, mobile: account.mobile, method: 'GOOGLE', success: true, reason: 'SIGNUP' }, tx);
        const session = await createSession(account.id, req, tx);
        return { account, session };
      });
      announceSignup(result.account.fullName, 'GOOGLE', result.account.id);
      res.status(201).json({ ok: true, token: result.session.token, expiresAt: result.session.expiresAt, account: presentAccount(result.account) });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new HttpError(409, 'This mobile number or Google account is already registered. Please sign in.', { code: 'ALREADY_REGISTERED' });
      }
      throw err;
    }
  }),
);

// POST /api/customer-auth/logout — end this session.
customerAuthRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      await prisma.customerSession.updateMany({
        where: { tokenHash: hashToken(header.slice(7)), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    res.json({ ok: true });
  }),
);

// GET /api/customer-auth/me
customerAuthRouter.get(
  '/me',
  requireCustomer,
  asyncHandler(async (req, res) => {
    const account = await prisma.customerAccount.findUniqueOrThrow({ where: { id: req.customer!.id }, include: { identities: true } });
    res.json({ ok: true, account: presentAccount(account) });
  }),
);
