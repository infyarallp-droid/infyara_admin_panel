import type { Prisma } from '@prisma/client';
import type { Tx } from './counters.js';

/** Append an audit-trail row. Pass the transaction client so it commits with the change it records. */
export async function audit(
  tx: Tx,
  args: { userId?: string | null; action: string; entity: string; entityId?: string | null; meta?: Prisma.InputJsonValue },
) {
  await tx.auditLog.create({
    data: {
      userId: args.userId ?? null,
      action: args.action,
      entity: args.entity,
      entityId: args.entityId ?? null,
      meta: args.meta,
    },
  });
}
