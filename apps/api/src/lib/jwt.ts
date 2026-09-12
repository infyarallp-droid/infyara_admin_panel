import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from './env.js';
import type { UserRole } from '@prisma/client';

export interface JwtPayload {
  sub: string; // user id
  role: UserRole;
  name: string;
}

// @types/jsonwebtoken v9 types expiresIn as a template-literal StringValue;
// our env values are plain strings (e.g. "15m"), valid at runtime.
const accessOpts: SignOptions = { expiresIn: env.JWT_ACCESS_TTL as SignOptions['expiresIn'] };
const refreshOpts: SignOptions = { expiresIn: env.JWT_REFRESH_TTL as SignOptions['expiresIn'] };

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, accessOpts);
}

export function signRefreshToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, refreshOpts);
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}

export function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as JwtPayload;
}
