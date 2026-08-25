import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard, parseBody, notFound } from '@/lib/route';
import { patchItemSchema } from '@/lib/validation';
import { normalizeName } from '@/lib/scoring';
import { writeRevision } from '@/lib/revisions';
import { nutrientMapFor, serializeItemRow, conflictResponse, ApiConflict, dayTotalsFor } from '@/lib/mealService';
import { toDateString } from '@/lib/dates';

export const dynamic = 'force-dynamic';

const itemInclude = { nutrients: { include: { nutrient: true } } } as const;

async function findItem(userId: string, mealId: string, itemId: string) {
  return prisma.mealItem.findFirst({
    where: { id: itemId, mealId, meal: { userId } },
    include: itemInclude,
  });
}

/** PATCH — correct quantity / nutrients / name / notes. Agent writes to pinned items 409 unless override. */
export const PATCH = apiRoute('patchMealItem', async (request: NextRequest, { params }) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/meals/[id]/items/[itemId]',
    nutrition: true,
    scope: 'nutrition:write',
    write: true,
  });
  if (error) return error;
  const { body, error: bodyError } = await parseBody(request, patchItemSchema);
  if (bodyError) return bodyError;

  const item = await findItem(auth.userId, params.id, params.itemId);
  if (!item || item.deletedAt) return notFound('Item not found');

  const isAgent = auth.tokenId !== null;
  if (item.pinned && isAgent && !body.override) {
    return NextResponse.json({ error: 'Entry pinned by user' }, { status: 409 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const before = serializeItemRow(item);
      const data: Prisma.MealItemUpdateInput = {};
      if (body.name !== undefined) {
        const normalized = normalizeName(body.name);
        if (normalized !== item.normalizedName) {
          const dup = await tx.mealItem.findUnique({
            where: { mealId_normalizedName: { mealId: item.mealId, normalizedName: normalized } },
          });
          if (dup && dup.deletedAt === null) {
            throw new ApiConflict({ error: 'Item already exists' });
          }
          if (dup) {
            // free the name held by a soft-deleted row
            await tx.mealItem.update({
              where: { id: dup.id },
              data: { normalizedName: `${dup.normalizedName}#deleted#${dup.id}` },
            });
          }
        }
        data.name = body.name;
        data.normalizedName = normalized;
      }
      if (body.quantity !== undefined) data.quantity = new Prisma.Decimal(body.quantity);
      if (body.notes !== undefined) data.notes = body.notes;
      // User (session) edits pin the item; agent edits never pin.
      if (!isAgent) data.pinned = true;

      if (body.nutrients) {
        const map = await nutrientMapFor(tx, auth.userId, Object.keys(body.nutrients));
        for (const [code, amt] of Object.entries(body.nutrients)) {
          await tx.mealItemNutrient.upsert({
            where: { itemId_nutrientId: { itemId: item.id, nutrientId: map.get(code)! } },
            create: { itemId: item.id, nutrientId: map.get(code)!, amountPerUnit: new Prisma.Decimal(amt) },
            update: { amountPerUnit: new Prisma.Decimal(amt) },
          });
        }
      }

      const updated = await tx.mealItem.update({ where: { id: item.id }, data, include: itemInclude });
      await writeRevision(tx, auth, {
        entityType: 'MEAL_ITEM',
        entityId: item.id,
        action: 'UPDATE',
        before,
        after: serializeItemRow(updated),
        override: Boolean(body.override && item.pinned && isAgent),
      });
      const meal = await tx.meal.findUniqueOrThrow({ where: { id: item.mealId } });
      const dayTotals = await dayTotalsFor(tx, auth.userId, toDateString(meal.date));
      return { item: serializeItemRow(updated), dayTotals };
    });
    return NextResponse.json(result);
  } catch (e) {
    const conflict = conflictResponse(e);
    if (conflict) return conflict;
    throw e;
  }
});

/** DELETE — soft delete. Agent deletes of pinned items 409 unless override (as a query param or body is not read on DELETE; use ?override=true). */
export const DELETE = apiRoute('deleteMealItem', async (request: NextRequest, { params }) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/meals/[id]/items/[itemId]',
    nutrition: true,
    scope: 'nutrition:write',
    write: true,
  });
  if (error) return error;

  const item = await findItem(auth.userId, params.id, params.itemId);
  if (!item || item.deletedAt) return notFound('Item not found');

  const isAgent = auth.tokenId !== null;
  const override = request.nextUrl.searchParams.get('override') === 'true';
  if (item.pinned && isAgent && !override) {
    return NextResponse.json({ error: 'Entry pinned by user' }, { status: 409 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.mealItem.update({ where: { id: item.id }, data: { deletedAt: new Date() } });
    await writeRevision(tx, auth, {
      entityType: 'MEAL_ITEM',
      entityId: item.id,
      action: 'DELETE',
      before: serializeItemRow(item),
      override: Boolean(override && item.pinned && isAgent),
    });
  });
  return new NextResponse(null, { status: 204 });
});
