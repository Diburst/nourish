import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard, parseBody } from '@/lib/route';
import { parseDateToNoonUTC } from '@/lib/dates';
import { normalizeName } from '@/lib/scoring';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const importSchema = z.object({
  version: z.literal(1),
  nutrients: z
    .array(
      z.object({
        code: z.string(),
        displayName: z.string(),
        unit: z.string(),
        kind: z.enum(['ENERGY', 'MACRO', 'MICRO']),
        targetRule: z.enum(['MIN', 'MAX', 'RANGE']),
        sortOrder: z.number().int().optional(),
        archived: z.boolean().optional(),
      })
    )
    .default([]),
  mealTypes: z
    .array(
      z.object({
        code: z.string(),
        displayName: z.string(),
        sortOrder: z.number().int().optional(),
        archived: z.boolean().optional(),
      })
    )
    .default([]),
  targets: z
    .array(
      z.object({
        effectiveFrom: z.string(),
        effectiveTo: z.string().nullable(),
        values: z.record(z.string(), z.union([z.number(), z.object({ min: z.number(), max: z.number() })])),
      })
    )
    .default([]),
  weightGoals: z
    .array(
      z.object({
        effectiveFrom: z.string(),
        effectiveTo: z.string().nullable(),
        targetKg: z.number(),
        direction: z.enum(['LOSE', 'GAIN', 'MAINTAIN']),
      })
    )
    .default([]),
  meals: z
    .array(
      z.object({
        date: z.string(),
        mealType: z.string(),
        notes: z.string().nullable().optional(),
        items: z.array(
          z.object({
            name: z.string(),
            quantity: z.number().positive(),
            notes: z.string().nullable().optional(),
            nutrients: z.record(z.string(), z.number()),
            pinned: z.boolean().optional(),
          })
        ),
      })
    )
    .default([]),
  weights: z
    .array(z.object({ date: z.string(), valueKg: z.number().positive(), pinned: z.boolean().optional() }))
    .default([]),
});

/** POST /api/import — session only; fresh accounts only (refuses if any meal exists). */
export const POST = apiRoute('importData', async (request: NextRequest) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/import',
    nutrition: true,
    sessionOnly: true,
    write: true,
    bodyBytes: 20 * 1024 * 1024,
  });
  if (error) return error;
  const { body, error: bodyError } = await parseBody(request, importSchema);
  if (bodyError) return bodyError;

  const mealCount = await prisma.meal.count({ where: { userId: auth.userId } });
  if (mealCount > 0) {
    return NextResponse.json(
      { error: 'Import is only available on fresh accounts (no meals logged yet)' },
      { status: 409 }
    );
  }

  const counts = await prisma.$transaction(
    async (tx) => {
      // Nutrients: upsert by code (accounts come pre-seeded).
      for (const [i, n] of body.nutrients.entries()) {
        await tx.nutrient.upsert({
          where: { userId_code: { userId: auth.userId, code: n.code } },
          create: {
            userId: auth.userId,
            code: n.code,
            displayName: n.displayName,
            unit: n.unit,
            kind: n.kind,
            targetRule: n.targetRule,
            sortOrder: n.sortOrder ?? i,
            archivedAt: n.archived ? new Date() : null,
          },
          update: {
            displayName: n.displayName,
            unit: n.unit,
            kind: n.kind,
            targetRule: n.targetRule,
            sortOrder: n.sortOrder ?? i,
            archivedAt: n.archived ? new Date() : null,
          },
        });
      }
      for (const [i, m] of body.mealTypes.entries()) {
        await tx.mealType.upsert({
          where: { userId_code: { userId: auth.userId, code: m.code } },
          create: {
            userId: auth.userId,
            code: m.code,
            displayName: m.displayName,
            sortOrder: m.sortOrder ?? i,
            archivedAt: m.archived ? new Date() : null,
          },
          update: {
            displayName: m.displayName,
            sortOrder: m.sortOrder ?? i,
            archivedAt: m.archived ? new Date() : null,
          },
        });
      }

      const nutrients = await tx.nutrient.findMany({ where: { userId: auth.userId } });
      const nutrientId = new Map(nutrients.map((n) => [n.code, n.id]));
      const mealTypes = await tx.mealType.findMany({ where: { userId: auth.userId } });
      const mealTypeId = new Map(mealTypes.map((m) => [m.code, m.id]));

      await tx.target.deleteMany({ where: { userId: auth.userId } });
      for (const t of body.targets) {
        await tx.target.create({
          data: {
            userId: auth.userId,
            effectiveFrom: parseDateToNoonUTC(t.effectiveFrom),
            effectiveTo: t.effectiveTo ? parseDateToNoonUTC(t.effectiveTo) : null,
            values: t.values as Prisma.InputJsonValue,
            source: 'USER',
          },
        });
      }
      await tx.weightGoal.deleteMany({ where: { userId: auth.userId } });
      for (const g of body.weightGoals) {
        await tx.weightGoal.create({
          data: {
            userId: auth.userId,
            effectiveFrom: parseDateToNoonUTC(g.effectiveFrom),
            effectiveTo: g.effectiveTo ? parseDateToNoonUTC(g.effectiveTo) : null,
            targetKg: new Prisma.Decimal(g.targetKg),
            direction: g.direction,
            source: 'USER',
          },
        });
      }

      let itemCount = 0;
      for (const meal of body.meals) {
        const mtId = mealTypeId.get(meal.mealType);
        if (!mtId) continue;
        const created = await tx.meal.create({
          data: {
            userId: auth.userId,
            date: parseDateToNoonUTC(meal.date),
            mealTypeId: mtId,
            notes: meal.notes ?? null,
            source: 'USER',
          },
        });
        for (const item of meal.items) {
          const validEntries = Object.entries(item.nutrients).filter(([code]) => nutrientId.has(code));
          await tx.mealItem.create({
            data: {
              mealId: created.id,
              userId: auth.userId,
              name: item.name,
              normalizedName: normalizeName(item.name),
              quantity: new Prisma.Decimal(item.quantity),
              notes: item.notes ?? null,
              source: 'USER',
              pinned: item.pinned ?? false,
              nutrients: {
                create: validEntries.map(([code, amt]) => ({
                  nutrientId: nutrientId.get(code)!,
                  amountPerUnit: new Prisma.Decimal(amt),
                })),
              },
            },
          });
          itemCount++;
        }
      }

      for (const w of body.weights) {
        await tx.weight.upsert({
          where: { userId_date: { userId: auth.userId, date: parseDateToNoonUTC(w.date) } },
          create: {
            userId: auth.userId,
            date: parseDateToNoonUTC(w.date),
            valueKg: new Prisma.Decimal(w.valueKg),
            source: 'USER',
            pinned: w.pinned ?? false,
          },
          update: { valueKg: new Prisma.Decimal(w.valueKg) },
        });
      }

      return {
        meals: body.meals.length,
        items: itemCount,
        weights: body.weights.length,
        targets: body.targets.length,
      };
    },
    { timeout: 60_000 }
  );

  logger.info('Import complete', { userId: auth.userId, ...counts });
  return NextResponse.json({ imported: counts }, { status: 201 });
});
