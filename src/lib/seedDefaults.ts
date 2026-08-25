import { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export const DEFAULT_NUTRIENTS = [
  { code: 'KCAL', displayName: 'Calories', unit: 'kcal', kind: 'ENERGY', targetRule: 'MAX' },
  { code: 'PROT', displayName: 'Protein', unit: 'g', kind: 'MACRO', targetRule: 'MIN' },
  { code: 'K', displayName: 'Potassium', unit: 'mg', kind: 'MICRO', targetRule: 'MIN' },
  { code: 'CA', displayName: 'Calcium', unit: 'mg', kind: 'MICRO', targetRule: 'MIN' },
  { code: 'MG', displayName: 'Magnesium', unit: 'mg', kind: 'MICRO', targetRule: 'MIN' },
  { code: 'FE', displayName: 'Iron', unit: 'mg', kind: 'MICRO', targetRule: 'MIN' },
  { code: 'ZN', displayName: 'Zinc', unit: 'mg', kind: 'MICRO', targetRule: 'MIN' },
  { code: 'VITA', displayName: 'Vitamin A', unit: 'µg', kind: 'MICRO', targetRule: 'MIN' },
  { code: 'VITC', displayName: 'Vitamin C', unit: 'mg', kind: 'MICRO', targetRule: 'MIN' },
  { code: 'VITD', displayName: 'Vitamin D', unit: 'µg', kind: 'MICRO', targetRule: 'MIN' },
  { code: 'VITE', displayName: 'Vitamin E', unit: 'mg', kind: 'MICRO', targetRule: 'MIN' },
  { code: 'VITK', displayName: 'Vitamin K', unit: 'µg', kind: 'MICRO', targetRule: 'MIN' },
  { code: 'B12', displayName: 'Vitamin B12', unit: 'µg', kind: 'MICRO', targetRule: 'MIN' },
  { code: 'FOLATE', displayName: 'Folate', unit: 'µg', kind: 'MICRO', targetRule: 'MIN' },
  { code: 'OMEGA3', displayName: 'Omega-3', unit: 'g', kind: 'MICRO', targetRule: 'MIN' },
] as const;

export const DEFAULT_MEAL_TYPES = [
  { code: 'BREAKFAST', displayName: 'Breakfast' },
  { code: 'LUNCH', displayName: 'Lunch' },
  { code: 'DINNER', displayName: 'Dinner' },
  { code: 'SNACK', displayName: 'Snack' },
  { code: 'DRINK', displayName: 'Drink' },
] as const;

/** Seed the per-user nutrient list and meal types for a freshly created user. */
export async function seedUserDefaults(tx: Tx, userId: string) {
  await tx.nutrient.createMany({
    data: DEFAULT_NUTRIENTS.map((n, i) => ({
      userId,
      code: n.code,
      displayName: n.displayName,
      unit: n.unit,
      kind: n.kind,
      targetRule: n.targetRule,
      sortOrder: i,
    })),
    skipDuplicates: true,
  });
  await tx.mealType.createMany({
    data: DEFAULT_MEAL_TYPES.map((m, i) => ({
      userId,
      code: m.code,
      displayName: m.displayName,
      sortOrder: i,
    })),
    skipDuplicates: true,
  });
}
