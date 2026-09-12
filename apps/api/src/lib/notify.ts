import type { NotificationType, UserRole } from '@prisma/client';
import { prisma } from './prisma.js';

/** Create an in-app notification (per-user or broadcast to a role). The bell
 *  polls the unread count every ~30s, so no realtime transport is required. */
export async function notify(args: {
  type: NotificationType;
  title: string;
  body?: string;
  userId?: string;
  roleTarget?: UserRole;
  entity?: string;
  entityId?: string;
}) {
  return prisma.notification.create({
    data: {
      type: args.type,
      title: args.title,
      body: args.body,
      userId: args.userId ?? null,
      roleTarget: args.roleTarget ?? null,
      entity: args.entity,
      entityId: args.entityId,
    },
  });
}
