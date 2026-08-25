/**
 * Demo data for the dev loop: `npm run db:seed`.
 * Creates demo@example.com (password: demo-password) with three weeks of meals,
 * weights, targets, and two guideline sections.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const NUTRIENTS = [
  ['KCAL', 'Calories', 'kcal', 'ENERGY', 'MAX'],
  ['PROT', 'Protein', 'g', 'MACRO', 'MIN'],
  ['K', 'Potassium', 'mg', 'MICRO', 'MIN'],
  ['CA', 'Calcium', 'mg', 'MICRO', 'MIN'],
  ['MG', 'Magnesium', 'mg', 'MICRO', 'MIN'],
  ['FE', 'Iron', 'mg', 'MICRO', 'MIN'],
  ['ZN', 'Zinc', 'mg', 'MICRO', 'MIN'],
  ['VITA', 'Vitamin A', 'µg', 'MICRO', 'MIN'],
  ['VITC', 'Vitamin C', 'mg', 'MICRO', 'MIN'],
  ['VITD', 'Vitamin D', 'µg', 'MICRO', 'MIN'],
  ['VITE', 'Vitamin E', 'mg', 'MICRO', 'MIN'],
  ['VITK', 'Vitamin K', 'µg', 'MICRO', 'MIN'],
  ['B12', 'Vitamin B12', 'µg', 'MICRO', 'MIN'],
  ['FOLATE', 'Folate', 'µg', 'MICRO', 'MIN'],
  ['OMEGA3', 'Omega-3', 'g', 'MICRO', 'MIN'],
] as const;

const MEAL_TYPES = [
  ['BREAKFAST', 'Breakfast'],
  ['LUNCH', 'Lunch'],
  ['DINNER', 'Dinner'],
  ['SNACK', 'Snack'],
  ['DRINK', 'Drink'],
] as const;

function noon(dateStr: string): Date {
  return new Date(`${dateStr}T12:00:00Z`);
}

function dayStr(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const email = 'demo@example.com';
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log('Demo user already exists — skipping seed.');
    return;
  }

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash('demo-password', 12),
      name: 'Demo User',
      timezone: 'America/Los_Angeles',
      createdAt: noon(dayStr(-30)),
    },
  });

  await prisma.nutrient.createMany({
    data: NUTRIENTS.map(([code, displayName, unit, kind, targetRule], i) => ({
      userId: user.id,
      code,
      displayName,
      unit,
      kind,
      targetRule,
      sortOrder: i,
    })),
  });
  await prisma.mealType.createMany({
    data: MEAL_TYPES.map(([code, displayName], i) => ({
      userId: user.id,
      code,
      displayName,
      sortOrder: i,
    })),
  });

  await prisma.target.create({
    data: {
      userId: user.id,
      effectiveFrom: noon(dayStr(-30)),
      values: {
        KCAL: 1900,
        PROT: 140,
        K: 3400,
        CA: 1000,
        MG: 400,
        FE: 8,
        ZN: 11,
        VITA: 900,
        VITC: 90,
        VITD: 15,
        VITE: 15,
        VITK: 120,
        B12: 2.4,
        FOLATE: 400,
        OMEGA3: 1.6,
      },
      source: 'SEED',
    },
  });
  await prisma.weightGoal.create({
    data: {
      userId: user.id,
      effectiveFrom: noon(dayStr(-30)),
      targetKg: new Prisma.Decimal(74.8), // ~165 lb
      direction: 'LOSE',
      source: 'SEED',
    },
  });

  const nutrients = await prisma.nutrient.findMany({ where: { userId: user.id } });
  const nid = new Map(nutrients.map((n) => [n.code, n.id]));
  const mealTypes = await prisma.mealType.findMany({ where: { userId: user.id } });
  const mtid = new Map(mealTypes.map((m) => [m.code, m.id]));

  const menu = [
    { type: 'BREAKFAST', name: 'Greek yogurt with berries', n: { KCAL: 320, PROT: 22, CA: 260, K: 380, B12: 1.1, VITC: 25 } },
    { type: 'LUNCH', name: 'Chicken burrito bowl', n: { KCAL: 720, PROT: 48, MG: 95, K: 900, FE: 3.5, ZN: 3, FOLATE: 120, VITA: 160 } },
    { type: 'DINNER', name: 'Salmon, rice and broccoli', n: { KCAL: 640, PROT: 42, OMEGA3: 1.8, VITD: 12, K: 850, MG: 80, VITC: 70, VITK: 110, VITE: 4 } },
    { type: 'SNACK', name: 'Pumpkin seeds', n: { KCAL: 160, PROT: 8, MG: 150, ZN: 2.2, FE: 2.3, VITE: 0.6 } },
  ];

  for (let offset = -21; offset <= 0; offset++) {
    const date = dayStr(offset);
    const skipDay = offset % 9 === -4; // an occasional unlogged day
    if (skipDay) continue;
    const heavyDay = offset % 6 === -2; // an occasional kcal fail
    for (const entry of menu) {
      const meal = await prisma.meal.create({
        data: {
          userId: user.id,
          date: noon(date),
          mealTypeId: mtid.get(entry.type)!,
          source: 'SEED',
        },
      });
      const scale = heavyDay && entry.type === 'DINNER' ? 1.8 : 1;
      await prisma.mealItem.create({
        data: {
          mealId: meal.id,
          userId: user.id,
          name: entry.name,
          normalizedName: entry.name.toLowerCase(),
          quantity: new Prisma.Decimal(scale),
          source: 'SEED',
          nutrients: {
            create: Object.entries(entry.n).map(([code, amt]) => ({
              nutrientId: nid.get(code)!,
              amountPerUnit: new Prisma.Decimal(amt),
            })),
          },
        },
      });
    }
    await prisma.weight.create({
      data: {
        userId: user.id,
        date: noon(date),
        valueKg: new Prisma.Decimal(78.5 + offset * 0.045 + Math.sin(offset) * 0.3),
        source: 'SEED',
      },
    });
  }

  const pantry = await prisma.guidelineSection.create({
    data: { slug: 'pantry-staples', title: 'Pantry Staples', sortOrder: 1 },
  });
  await prisma.guidelineRevision.create({
    data: {
      sectionId: pantry.id,
      body: '## Seeds & nuts\n\nKeep pumpkin seeds and almonds around — easy magnesium and zinc.\n\n## Tinned fish\n\nSardines and salmon cover omega-3 and vitamin D cheaply.',
      links: [
        { label: 'Pumpkin seeds', nutrients: ['MG', 'ZN'] },
        { label: 'Sardines', nutrients: ['OMEGA3', 'VITD', 'CA'] },
        { label: 'Almonds', nutrients: ['MG', 'VITE'] },
      ],
      authorUserId: user.id,
    },
  });
  const ideas = await prisma.guidelineSection.create({
    data: { slug: 'meal-ideas', title: 'Meal Ideas', sortOrder: 2 },
  });
  await prisma.guidelineRevision.create({
    data: {
      sectionId: ideas.id,
      body: '## High-potassium dinners\n\nBaked potato + salmon; white bean stew with spinach.\n\n## Folate boosts\n\nLentil salads, edamame, asparagus sides.',
      links: [
        { label: 'White bean stew', nutrients: ['K', 'FE', 'FOLATE'] },
        { label: 'Lentil salad', nutrients: ['FOLATE', 'FE'] },
      ],
      authorUserId: user.id,
    },
  });

  console.log('Seeded demo user: demo@example.com / demo-password');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
