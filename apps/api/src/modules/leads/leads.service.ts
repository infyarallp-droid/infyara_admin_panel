import type { Prisma, LeadSource } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { notify } from '../../lib/notify.js';

export interface NormalizedLead {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  message?: string | null;
  source: LeadSource;
  sourceDetail?: Prisma.InputJsonValue;
}

/** Create a lead from any channel + raise a NEW_LEAD notification for admins. */
export async function createLead(input: NormalizedLead) {
  const lead = await prisma.lead.create({
    data: {
      name: input.name ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      message: input.message ?? null,
      source: input.source,
      sourceDetail: input.sourceDetail,
    },
  });
  await notify({
    type: 'NEW_LEAD',
    title: `New lead from ${input.source}`,
    body: `${input.name ?? 'Unknown'}${input.phone ? ` · ${input.phone}` : ''}`,
    roleTarget: 'ADMIN',
    entity: 'lead',
    entityId: lead.id,
  });
  return lead;
}

/** Log a raw inbound webhook hit (for debugging / replay). */
export async function logWebhook(channel: string, rawPayload: Prisma.InputJsonValue, signatureValid: boolean | null, error?: string) {
  return prisma.webhookEvent.create({
    data: { channel, rawPayload, signatureValid, processed: !error, error: error ?? null },
  });
}
