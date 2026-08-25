import { prisma } from '@/lib/prisma';
import { parseDateToNoonUTC, toDateString, todayInTz, dateRange, addDays } from '@/lib/dates';
import {
  TargetRow,
  TargetValues,
  NutrientDef,
  targetForDate,
  dayStatus,
  daySuccess,
  liveDaySuccess,
  successStreak,
  DayStatus,
  evaluateRule,
  targetAmount,
} from '@/lib/scoring';

export interface SerializedItem {
  id: string;
  name: string;
  quantity: number;
  notes: string | null;
  nutrients: Record<string, number>;
  totals: Record<string, number>;
  pinned: boolean;
  source: string;
  tokenId: string | null;
}

export interface SerializedMeal {
  id: string;
  date: string;
  mealType: string;
  mealTypeName: string;
  notes: string | null;
  items: SerializedItem[];
  totals: Record<string, number>;
}

export interface DayData {
  date: string;
  logged: boolean;
  status: DayStatus;
  liveSuccess: boolean;
  totals: Record<string, number>;
  target: TargetValues | null;
  meals: SerializedMeal[];
  weightKg: number | null;
}

export interface UserContext {
  id: string;
  timezone: string;
  createdAt: Date;
}

export async function loadNutrients(userId: string): Promise<NutrientDef[]> {
  const rows = await prisma.nutrient.findMany({
    where: { userId },
    orderBy: { sortOrder: 'asc' },
  });
  return rows.map((n) => ({
    code: n.code,
    displayName: n.displayName,
    unit: n.unit,
    kind: n.kind,
    targetRule: n.targetRule,
    archived: n.archivedAt !== null,
  }));
}

export async function loadTargetRows(userId: string): Promise<TargetRow[]> {
  const rows = await prisma.target.findMany({
    where: { userId },
    orderBy: { effectiveFrom: 'asc' },
  });
  return rows.map((t) => ({
    effectiveFrom: toDateString(t.effectiveFrom),
    effectiveTo: t.effectiveTo ? toDateString(t.effectiveTo) : null,
    values: t.values as TargetValues,
  }));
}

type MealWithItems = Awaited<ReturnType<typeof loadMeals>>[number];

async function loadMeals(userId: string, from: string, to: string) {
  return prisma.meal.findMany({
    where: {
      userId,
      deletedAt: null,
      date: { gte: parseDateToNoonUTC(from), lte: parseDateToNoonUTC(to) },
    },
    include: {
      mealType: true,
      items: { include: { nutrients: { include: { nutrient: true } } } },
    },
    orderBy: [{ date: 'asc' }, { mealType: { sortOrder: 'asc' } }],
  });
}

export function serializeMeal(meal: MealWithItems): SerializedMeal {
  const items: SerializedItem[] = meal.items
    .filter((i) => i.deletedAt === null)
    .map((i) => {
      const perUnit: Record<string, number> = {};
      const totals: Record<string, number> = {};
      const qty = Number(i.quantity);
      for (const n of i.nutrients) {
        const amount = Number(n.amountPerUnit);
        perUnit[n.nutrient.code] = amount;
        totals[n.nutrient.code] = amount * qty;
      }
      return {
        id: i.id,
        name: i.name,
        quantity: qty,
        notes: i.notes,
        nutrients: perUnit,
        totals,
        pinned: i.pinned,
        source: i.source,
        tokenId: i.tokenId,
      };
    });
  const totals: Record<string, number> = {};
  for (const item of items) {
    for (const [code, v] of Object.entries(item.totals)) {
      totals[code] = (totals[code] ?? 0) + v;
    }
  }
  return {
    id: meal.id,
    date: toDateString(meal.date),
    mealType: meal.mealType.code,
    mealTypeName: meal.mealType.displayName,
    notes: meal.notes,
    items,
    totals,
  };
}

/** Compute per-day data (totals, meals, status) for [from, to]. */
export async function getDaysData(user: UserContext, from: string, to: string): Promise<DayData[]> {
  const [meals, targets, weights] = await Promise.all([
    loadMeals(user.id, from, to),
    loadTargetRows(user.id),
    prisma.weight.findMany({
      where: { userId: user.id, date: { gte: parseDateToNoonUTC(from), lte: parseDateToNoonUTC(to) } },
    }),
  ]);

  const today = todayInTz(user.timezone);
  const accountCreatedDate = todayInTz(user.timezone, user.createdAt);
  const mealsByDate = new Map<string, SerializedMeal[]>();
  for (const meal of meals) {
    const s = serializeMeal(meal);
    if (s.items.length === 0 && meal.deletedAt) continue;
    const arr = mealsByDate.get(s.date) ?? [];
    arr.push(s);
    mealsByDate.set(s.date, arr);
  }
  const weightByDate = new Map(weights.map((w) => [toDateString(w.date), Number(w.valueKg)]));

  return dateRange(from, to).map((date) => {
    const dayMeals = mealsByDate.get(date) ?? [];
    const totals: Record<string, number> = {};
    for (const m of dayMeals) {
      for (const [code, v] of Object.entries(m.totals)) totals[code] = (totals[code] ?? 0) + v;
    }
    const logged = dayMeals.some((m) => m.items.length > 0);
    const target = targetForDate(targets, date);
    return {
      date,
      logged,
      status: dayStatus({ date, logged, totals, target, today, accountCreatedDate }),
      liveSuccess: liveDaySuccess(totals, target, logged),
      totals,
      target: target?.values ?? null,
      meals: dayMeals,
      weightKg: weightByDate.get(date) ?? null,
    };
  });
}

/** Success streak ending today (see scoring.successStreak). Scans back up to 400 days. */
export async function getStreak(user: UserContext, lookbackDays = 400): Promise<number> {
  const today = todayInTz(user.timezone);
  const from = addDays(today, -lookbackDays);
  const days = await getDaysData(user, from, today);
  return successStreak(
    days.map((d) => ({
      date: d.date,
      logged: d.logged,
      success:
        d.date === today
          ? d.liveSuccess
            ? true
            : null
          : d.status === 'success'
            ? true
            : d.status === 'fail'
              ? false
              : null,
    })),
    today
  );
}

/** Per-nutrient live status for today's bars. */
export function todayNutrientStatus(
  totals: Record<string, number>,
  target: TargetValues | null,
  def: NutrientDef
): { intake: number; status: 'met' | 'pending' | 'exceeded' | 'none'; min?: number; max?: number } {
  const intake = totals[def.code] ?? 0;
  const value = target?.[def.code];
  if (value === undefined) return { intake, status: 'none' };
  const amt = targetAmount(value, def.targetRule);
  return { intake, status: evaluateRule(def.targetRule, intake, value), ...amt };
}

export { daySuccess };
