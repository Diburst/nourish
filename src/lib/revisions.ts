import { Prisma } from '@prisma/client';
import type { AuthPrincipal } from '@/lib/apiAuth';
import { actorOf } from '@/lib/apiAuth';

type Tx = Prisma.TransactionClient;

/**
 * Write an EntryRevision inside the caller's transaction. Every create / update /
 * delete / override of user data goes through here.
 */
export async function writeRevision(
  tx: Tx,
  auth: AuthPrincipal,
  params: {
    entityType: 'MEAL' | 'MEAL_ITEM' | 'WEIGHT' | 'TARGET' | 'WEIGHT_GOAL' | 'NUTRIENT' | 'MEAL_TYPE';
    entityId: string;
    action: 'CREATE' | 'UPDATE' | 'DELETE' | 'RESTORE' | 'ARCHIVE' | 'CORRECT';
    before?: unknown;
    after?: unknown;
    override?: boolean;
  }
) {
  const { actorType, actorId } = actorOf(auth);
  await tx.entryRevision.create({
    data: {
      userId: auth.userId,
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      before: params.before === undefined ? Prisma.JsonNull : (params.before as Prisma.InputJsonValue),
      after: params.after === undefined ? Prisma.JsonNull : (params.after as Prisma.InputJsonValue),
      actorType,
      actorId,
      override: params.override ?? false,
    },
  });
}
