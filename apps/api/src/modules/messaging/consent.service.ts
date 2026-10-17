import type { ConsentState } from '@prisma/client';
import { normalizeMobile } from '@moksha/shared';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../lib/env.js';
import type { Tx } from '../../lib/counters.js';

// WhatsApp opt-in ledger. Rows are append-only; the newest row for a mobile is
// its current state, so the full history (who, when, how, exact wording) is kept.

export type ConsentSource = 'WEBSITE_SIGNUP' | 'ACCOUNT_SETTINGS' | 'STAFF_RECORDED' | 'INBOUND_KEYWORD';

const key = (mobile: string) => normalizeMobile(mobile) ?? mobile.replace(/\D/g, '').slice(-10);

export async function currentConsent(mobile: string | null | undefined, tx: Tx = prisma): Promise<ConsentState | null> {
  if (!mobile) return null;
  const row = await tx.whatsAppConsent.findFirst({ where: { mobile: key(mobile) }, orderBy: { createdAt: 'desc' } });
  return row?.state ?? null;
}

/** Current state for many mobiles at once (latest row per mobile). */
export async function consentMap(mobiles: string[]): Promise<Map<string, ConsentState>> {
  const keys = [...new Set(mobiles.filter(Boolean).map(key))];
  const map = new Map<string, ConsentState>();
  if (!keys.length) return map;
  const rows = await prisma.whatsAppConsent.findMany({
    where: { mobile: { in: keys } },
    orderBy: { createdAt: 'desc' },
    select: { mobile: true, state: true },
  });
  for (const r of rows) if (!map.has(r.mobile)) map.set(r.mobile, r.state);
  return map;
}

/** May a business-initiated WhatsApp message be sent to this number? */
export async function mayMessage(mobile: string | null | undefined): Promise<boolean> {
  if (!env.WHATSAPP_REQUIRE_CONSENT) return true;
  return (await currentConsent(mobile)) === 'OPTED_IN';
}

/** Record a consent change. A row is only added when the state actually changes. */
export async function recordConsent(
  args: {
    mobile: string;
    state: ConsentState;
    source: ConsentSource;
    consentText?: string | null;
    studentId?: string | null;
    accountId?: string | null;
    recordedById?: string | null;
    ip?: string | null;
  },
  tx: Tx = prisma,
) {
  const mobile = key(args.mobile);
  if ((await currentConsent(mobile, tx)) === args.state) return null;
  return tx.whatsAppConsent.create({
    data: {
      mobile,
      state: args.state,
      source: args.source,
      consentText: args.consentText ?? null,
      studentId: args.studentId ?? null,
      accountId: args.accountId ?? null,
      recordedById: args.recordedById ?? null,
      ip: args.ip ?? null,
    },
  });
}

/** Inbound keywords that change consent (case-insensitive, whole message). */
export function consentKeyword(text: string): ConsentState | null {
  const t = text.trim().toUpperCase();
  if (['STOP', 'UNSUBSCRIBE', 'STOP ALL', 'OPT OUT', 'OPTOUT'].includes(t)) return 'OPTED_OUT';
  if (['START', 'SUBSCRIBE', 'OPT IN', 'OPTIN'].includes(t)) return 'OPTED_IN';
  return null;
}
