import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseDateToNoonUTC } from '@/lib/dates';
import { normalizeName } from '@/lib/scoring';
import { writeRevision } from '@/lib/revisions';
import { actorOf, AuthPrincipal } from '@/lib/apiAuth';
import { serializeMeal, SerializedItem } from '@/lib/dayData';

type Tx = Prisma.TransactionClient;

export interface ItemInput {
  idempotencyKey?: string;
  name: string;
  quantity: number;
  notes?: string;
  nutrients: Record<string, number>;
}

export class ApiConflict extends Error {
  constructor(
    public payload: Record<string, unknown>,
    public status = 409
  ) {
    super(String(payload.error));
  }
}

/** Map nutrient codes → ids for a user; throws a 400-shaped conflict on unknown codes. */
export async function nutrientMapFor(
  tx: Tx,
  userId: string,
  codes: string[]
): Promise<Map<string, string>> {
  const all = await tx.nutrient.findMany({ where: { userId } });
  const map = new Map(all.map((n) => [n.code, n.id]));
  const unknown = codes.filter((c) => !map.has(c));
  if (unknown.length > 0) {
    throw new ApiConflict(
      {
        error: `Unknown nutrient code${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. Valid codes: ${[...map.keys()].join(', ')}`,
      },
      400
    );
  }
  return map;
}

export function serializeItemRow(item: {
  id: string;
  name: string;
  quantity: Prisma.Decimal;
  notes: string | null;
  pinned: boolean;
  source: string;
  tokenId: string | null;
  deletedAt: Date | null;
  nutrients: { amountPerUnit: Prisma.Decimal; nutrient: { code: string } }[];
}): SerializedItem & { deleted: boolean } {
  const perUnit: Record<string, number> = {};
  const totals: Record<string, number> = {};
  const qty = Number(item.quantity);
  for (const n of item.nutrients) {
    perUnit[n.nutrient.code] = Number(n.amountPerUnit);
    totals[n.nutrient.code] = Number(n.amountPerUnit) * qty;
  }
  return {
    id: item.id,
    name: item.name,
    quantity: qty,
    notes: item.notes,
    nutrients: perUnit,
    totals,
    pinned: item.pinned,
    source: item.source,
    tokenId: item.tokenId,
    deleted: item.deletedAt !== null,
  };
}

const itemInclude = { nutrients: { include: { nutrient: true } } } as const;

/**
 * Append one item to a meal slot, enforcing idempotency and the never-two-identical-items
 * rule. Returns { item, replayed } — replayed means the idempotency key matched and the
 * existing item was returned untouched (200, even if soft-deleted).
 */
export async function appendItem(
  tx: Tx,
  auth: AuthPrincipal,
  meal: { id: string; userId: string },
  input: ItemInput,
  onConflict?: 'replace' | 'increment'
): Promise<{ item: ReturnType<typeof serializeItemRow>; replayed: boolean; created: boolean }> {
  const { source } = actorOf(auth);

  if (input.idempotencyKey) {
    const existing = await tx.mealItem.findUnique({
      where: { userId_idempotencyKey: { userId: meal.userId, idempotencyKey: input.idempotencyKey } },
      include: itemInclude,
    });
    if (existing) {
      return { item: serializeItemRow(existing), replayed: true, created: false };
    }
  }

  const normalized = normalizeName(input.name);
  const dup = await tx.mealItem.findUnique({
    where: { mealId_normalizedName: { mealId: meal.id, normalizedName: normalized } },
    include: itemInclude,
  });

  const nutrientMap = await nutrientMapFor(tx, meal.userId, Object.keys(input.nutrients));

  if (dup && dup.deletedAt === null) {
    if (!onConflict) {
      throw new ApiConflict({ error: 'Item already exists', item: serializeItemRow(dup) });
    }
    const before = serializeItemRow(dup);
    if (onConflict === 'increment') {
      const updated = await tx.mealItem.update({
        where: { id: dup.id },
        data: { quantity: new Prisma.Decimal(Number(dup.quantity) + input.quantity) },
        include: itemInclude,
      });
      await writeRevision(tx, auth, {
        entityType: 'MEAL_ITEM',
        entityId: dup.id,
        action: 'UPDATE',
        before,
        after: serializeItemRow(updated),
      });
      return { item: serializeItemRow(updated), replayed: false, created: false };
    }
    // replace: overwrite quantity, notes and the full nutrient set
    await tx.mealItemNutrient.deleteMany({ where: { itemId: dup.id } });
    const updated = await tx.mealItem.update({
      where: { id: dup.id },
      data: {
        name: input.name,
        quantity: new Prisma.Decimal(input.quantity),
        notes: input.notes ?? null,
        idempotencyKey: input.idempotencyKey ?? dup.idempotencyKey,
        nutrients: {
          create: Object.entries(input.nutrients).map(([code, amt]) => ({
            nutrientId: nutrientMap.get(code)!,
            amountPerUnit: new Prisma.Decimal(amt),
          })),
        },
      },
      include: itemInclude,
    });
    await writeRevision(tx, auth, {
      entityType: 'MEAL_ITEM',
      entityId: dup.id,
      action: 'UPDATE',
      before,
      after: serializeItemRow(updated),
    });
    return { item: serializeItemRow(updated), replayed: false, created: false };
  }

  if (dup && dup.deletedAt !== null) {
    // Same name as a soft-deleted item: revive it with the new values.
    const before = serializeItemRow(dup);
    await tx.mealItemNutrient.deleteMany({ where: { itemId: dup.id } });
    const revived = await tx.mealItem.update({
      where: { id: dup.id },
      data: {
        name: input.name,
        quantity: new Prisma.Decimal(input.quantity),
        notes: input.notes ?? null,
        deletedAt: null,
        pinned: false,
        source,
        tokenId: auth.tokenId,
        idempotencyKey: input.idempotencyKey ?? null,
        nutrients: {
          create: Object.entries(input.nutrients).map(([code, amt]) => ({
            nutrientId: nutrientMap.get(code)!,
            amountPerUnit: new Prisma.Decimal(amt),
          })),
        },
      },
      include: itemInclude,
    });
    await writeRevision(tx, auth, {
      entityType: 'MEAL_ITEM',
      entityId: dup.id,
      action: 'RESTORE',
      before,
      after: serializeItemRow(revived),
    });
    return { item: serializeItemRow(revived), replayed: false, created: true };
  }

  const created = await tx.mealItem.create({
    data: {
      mealId: meal.id,
      userId: meal.userId,
      name: input.name,
      normalizedName: normalized,
      quantity: new Prisma.Decimal(input.quantity),
      notes: input.notes ?? null,
      source,
      tokenId: auth.tokenId,
      idempotencyKey: input.idempotencyKey ?? null,
      nutrients: {
        create: Object.entries(input.nutrients).map(([code, amt]) => ({
          nutrientId: nutrientMap.get(code)!,
          amountPerUnit: new Prisma.Decimal(amt),
        })),
      },
    },
    include: itemInclude,
  });
  await writeRevision(tx, auth, {
    entityType: 'MEAL_ITEM',
    entityId: created.id,
    action: 'CREATE',
    after: serializeItemRow(created),
  });
  return { item: serializeItemRow(created), replayed: false, created: true };
}

/** Upsert the meal slot for (userId, date, mealType). */
export async function upsertSlot(
  tx: Tx,
  auth: AuthPrincipal,
  params: { date: string; mealTypeCode: string; notes?: string }
) {
  const mealType = await tx.mealType.findUnique({
    where: { userId_code: { userId: auth.userId, code: params.mealTypeCode } },
  });
  if (!mealType || mealType.archivedAt) {
    const valid = await tx.mealType.findMany({
      where: { userId: auth.userId, archivedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
    throw new ApiConflict(
      { error: `Unknown meal type: ${params.mealTypeCode}. Valid types: ${valid.map((m) => m.code).join(', ')}` },
      400
    );
  }
  const { source } = actorOf(auth);
  const date = parseDateToNoonUTC(params.date);
  const existing = await tx.meal.findUnique({
    where: { userId_date_mealTypeId: { userId: auth.userId, date, mealTypeId: mealType.id } },
  });
  if (existing) {
    if (existing.deletedAt || params.notes !== undefined) {
      return tx.meal.update({
        where: { id: existing.id },
        data: { deletedAt: null, ...(params.notes !== undefined ? { notes: params.notes } : {}) },
      });
    }
    return existing;
  }
  const meal = await tx.meal.create({
    data: {
      userId: auth.userId,
      date,
      mealTypeId: mealType.id,
      notes: params.notes ?? null,
      source,
      tokenId: auth.tokenId,
    },
  });
  await writeRevision(tx, auth, {
    entityType: 'MEAL',
    entityId: meal.id,
    action: 'CREATE',
    after: { date: params.date, mealType: params.mealTypeCode, notes: params.notes ?? null },
  });
  return meal;
}

/** Load a meal (with items) owned by the principal; null if missing / other-user. */
export async function findOwnMeal(userId: string, mealId: string) {
  return prisma.meal.findFirst({
    where: { id: mealId, userId },
    include: { mealType: true, items: { include: itemInclude } },
  });
}

/** Day totals for a user + date (non-deleted items). */
export async function dayTotalsFor(tx: Tx, userId: string, date: string): Promise<Record<string, number>> {
  const meals = await tx.meal.findMany({
    where: { userId, date: parseDateToNoonUTC(date), deletedAt: null },
    include: { mealType: true, items: { include: itemInclude } },
  });
  const totals: Record<string, number> = {};
  for (const meal of meals) {
    const s = serializeMeal(meal as never);
    for (const [code, v] of Object.entries(s.totals)) totals[code] = (totals[code] ?? 0) + v;
  }
  return totals;
}

export function conflictResponse(e: unknown): NextResponse | null {
  if (e instanceof ApiConflict) {
    return NextResponse.json(e.payload, { status: e.status });
  }
  return null;
}
