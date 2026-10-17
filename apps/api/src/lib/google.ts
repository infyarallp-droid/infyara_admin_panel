import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';
import { env } from './env.js';
import { HttpError } from './http.js';

// Google sign-in. The website completes the OAuth code exchange (it holds the
// client secret) and forwards the ID token; this API verifies it independently
// against Google's published keys, issuer and our client id.

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksUrl = '';

export interface GoogleProfile {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

export function isGoogleConfigured(): boolean {
  return !!env.GOOGLE_CLIENT_ID;
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  if (!env.GOOGLE_CLIENT_ID) throw new HttpError(503, 'Google sign-in is not set up yet');
  if (!jwks || jwksUrl !== env.GOOGLE_JWKS_URL) {
    jwksUrl = env.GOOGLE_JWKS_URL;
    jwks = createRemoteJWKSet(new URL(jwksUrl));
  }
  try {
    const { payload } = await jwtVerify(idToken, jwks, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: env.GOOGLE_CLIENT_ID,
    });
    if (!payload.sub) throw new Error('missing sub');
    return {
      sub: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : null,
      emailVerified: payload.email_verified === true,
      name: typeof payload.name === 'string' ? payload.name : null,
    };
  } catch {
    throw new HttpError(401, 'Google sign-in could not be verified. Please try again.');
  }
}

// A short-lived signed ticket that carries a verified Google identity between
// "Continue with Google" and the "add your mobile number" step.
const pendingKey = () => new TextEncoder().encode(`${env.JWT_SECRET}:google-pending`);

export async function signGooglePending(p: GoogleProfile): Promise<string> {
  return new SignJWT({ email: p.email, name: p.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(p.sub)
    .setAudience('google-pending')
    .setIssuedAt()
    .setExpirationTime('20m')
    .sign(pendingKey());
}

export async function verifyGooglePending(token: string): Promise<GoogleProfile> {
  try {
    const { payload } = await jwtVerify(token, pendingKey(), { audience: 'google-pending' });
    return {
      sub: String(payload.sub),
      email: typeof payload.email === 'string' ? payload.email : null,
      emailVerified: true,
      name: typeof payload.name === 'string' ? payload.name : null,
    };
  } catch {
    throw new HttpError(401, 'Your Google sign-in has expired. Please choose "Continue with Google" again.');
  }
}
