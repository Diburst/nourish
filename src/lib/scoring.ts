/**
 * Pure scoring logic. No Prisma imports — everything here is unit-testable.
 *
 * Rules (spec §3.3):
 * - Logged day = at least one (non-deleted) meal item. Weight-only days are unlogged.
 * - Day success = KCAL <= target AND PROT >= target. Micros never affect day success.
 * - Week (Mon–Sun) success = every logged day succeeded AND every active micro's
 *   cumulative intake >= dailyTarget × 7 (flat, regardless of days logged).
 * - Weekly "on track" pace = cumulative >= dailyTarget × daysLoggedSoFar.
 * - Today is live: MAX → in progress until exceeded, then failed; MIN → in progress until met.
 * - Streak = consecutive successful days ending yesterday, +1 for today only once today
 *   is (currently) successful. Failed or unlogged days reset to 0.
 * - Days before the account/targets existed, or unlogged days: blank, never red.
 */

export type TargetRule = 'MIN' | 'MAX' | 'RANGE';
export type TargetValue = number | { min: number; max: number };
export type TargetValues = Record<string, TargetValue>;

export type DayStatus = 'success' | 'fail' | 'pending' | 'blank';

export interface NutrientDef {
  code: string;
  displayName: string;
  unit: string;
  kind: 'ENERGY' | 'MACRO' | 'MICRO';
  targetRule: TargetRule;
  archived: boolean;
}

export interface TargetRow {
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo: string | null;
  values: TargetValues;
}

/** A day's activity adjustment: one-day bumps to the energy and protein allowance. */
export interface ActivityAdjustment {
  kcal: number;
  proteinG: number;
}

export const ZERO_ADJUSTMENT: ActivityAdjustment = { kcal: 0, proteinG: 0 };

function bumpValue(value: TargetValue, by: number): TargetValue {
  if (typeof value === 'number') return value + by;
  return { min: value.min + by, max: value.max + by };
}

/**
 * Apply a day's activity adjustment to its baseline target row. Energy (KCAL) and
 * protein (PROT) only — every other nutrient passes through untouched. Returns the
 * row unchanged when there is nothing to apply, and null when there is no baseline
 * target: a day with an adjustment but no target stays blank (the blank-day rule
 * wins). Never writes anywhere — the baseline target history is untouched.
 */
export function applyAdjustment(target: TargetRow | null, adj: ActivityAdjustment | null | undefined): TargetRow | null {
  if (!target || !adj || (adj.kcal === 0 && adj.proteinG === 0)) return target;
  const values: TargetValues = { ...target.values };
  if (adj.kcal !== 0 && values['KCAL'] !== undefined) values['KCAL'] = bumpValue(values['KCAL'], adj.kcal);
  if (adj.proteinG !== 0 && values['PROT'] !== undefined) values['PROT'] = bumpValue(values['PROT'], adj.proteinG);
  return { ...target, values };
}

/** The target row in effect on a given date, or null. Rows must not overlap. */
export function targetForDate(rows: TargetRow[], date: string): TargetRow | null {
  for (const row of rows) {
    if (row.effectiveFrom <= date && (row.effectiveTo === null || date <= row.effectiveTo)) {
      return row;
    }
  }
  return null;
}

export function targetAmount(value: TargetValue | undefined, rule: TargetRule): { min?: number; max?: number } {
  if (value === undefined) return {};
  if (typeof value === 'number') {
    if (rule === 'MIN') return { min: value };
    if (rule === 'MAX') return { max: value };
    return { min: value, max: value };
  }
  return { min: value.min, max: value.max };
}

export type RuleStatus = 'met' | 'pending' | 'exceeded';

/**
 * Evaluate one nutrient against its rule.
 * - MIN: pending until intake >= min, then met.
 * - MAX: pending (fine so far) until intake > max, then exceeded.
 * - RANGE: exceeded when above max; met when within [min, max]; pending when below min.
 */
export function evaluateRule(rule: TargetRule, intake: number, value: TargetValue): RuleStatus {
  const { min, max } = targetAmount(value, rule);
  if (rule === 'MIN') return intake >= (min ?? 0) ? 'met' : 'pending';
  if (rule === 'MAX') return intake > (max ?? Infinity) ? 'exceeded' : 'pending';
  // RANGE
  if (max !== undefined && intake > max) return 'exceeded';
  if (min !== undefined && intake < min) return 'pending';
  return 'met';
}

/** Final-day evaluation of one nutrient: did it end the day satisfied? */
export function ruleSatisfiedAtDayEnd(rule: TargetRule, intake: number, value: TargetValue): boolean {
  const s = evaluateRule(rule, intake, value);
  if (rule === 'MAX') return s !== 'exceeded';
  return s === 'met';
}

/** Day success: KCAL <= target and PROT >= target. Requires both targets present. */
export function daySuccess(totals: Record<string, number>, values: TargetValues): boolean | null {
  const kcalTarget = targetAmount(values['KCAL'], 'MAX').max;
  const protTarget = targetAmount(values['PROT'], 'MIN').min;
  if (kcalTarget === undefined || protTarget === undefined) return null;
  return (totals['KCAL'] ?? 0) <= kcalTarget && (totals['PROT'] ?? 0) >= protTarget;
}

export interface DayEvalInput {
  date: string;
  logged: boolean;
  totals: Record<string, number>;
  target: TargetRow | null;
  today: string; // user-tz today
  accountCreatedDate: string;
}

/**
 * Calendar/day status.
 * - blank: unlogged, before the account existed, or no target covering the date.
 * - today: pending until failed is certain (KCAL exceeded → fail is still shown live per bars,
 *   but the calendar shows ⏱ for today; a day becomes final at local midnight).
 * - past: success / fail.
 */
export function dayStatus(input: DayEvalInput): DayStatus {
  const { date, logged, totals, target, today } = input;
  // Unlogged days (which include every day before the account existed) and days
  // with no covering target are blank — never red.
  if (date > today) return 'blank';
  if (!logged) return 'blank';
  if (!target) return 'blank';
  const success = daySuccess(totals, target.values);
  if (success === null) return 'blank';
  if (date === today) return 'pending';
  return success ? 'success' : 'fail';
}

/** Is the (live) day currently successful — used to extend the streak to today. */
export function liveDaySuccess(totals: Record<string, number>, target: TargetRow | null, logged: boolean): boolean {
  if (!target || !logged) return false;
  return daySuccess(totals, target.values) === true;
}

export interface StreakDay {
  date: string;
  logged: boolean;
  success: boolean | null; // null = not evaluable (blank)
}

/**
 * Success streak. `days` must cover consecutive dates ascending, ending at `today`.
 * Counts consecutive successful days ending yesterday; today's (live) success adds one.
 * A failed or unlogged evaluable day resets to 0; blank days (success === null) also
 * end the run since they cannot be successful.
 */
export function successStreak(days: StreakDay[], today: string): number {
  let streak = 0;
  const past = days.filter((d) => d.date < today).sort((a, b) => (a.date < b.date ? -1 : 1));
  for (let i = past.length - 1; i >= 0; i--) {
    if (past[i].success === true) streak++;
    else break;
  }
  const todayRow = days.find((d) => d.date === today);
  if (todayRow?.success === true) streak++;
  return streak;
}

/** Weekly micro check for week success: cumulative >= sum of that micro's daily targets across the 7 days. */
export function weekMicroSatisfied(
  code: string,
  rule: TargetRule,
  dayTargets: (TargetRow | null)[],
  cumulative: number
): boolean | null {
  let required = 0;
  let anyTarget = false;
  for (const t of dayTargets) {
    const amt = targetAmount(t?.values[code], rule);
    const req = rule === 'MAX' ? amt.max : amt.min;
    if (req !== undefined) {
      required += req;
      anyTarget = true;
    }
  }
  if (!anyTarget) return null;
  if (rule === 'MAX') return cumulative <= required;
  return cumulative >= required;
}

export interface WeekEvalInput {
  days: { date: string; logged: boolean; totals: Record<string, number>; target: TargetRow | null }[]; // 7, Mon..Sun
  micros: NutrientDef[]; // active (non-archived) MICRO nutrients
  today: string;
}

export interface WeekEvalResult {
  complete: boolean; // week fully in the past
  success: boolean | null; // null until evaluable/complete
  loggedDays: number;
  kcalDaysHit: number;
  protDaysHit: number;
  microStatus: {
    code: string;
    cumulative: number;
    requiredWeek: number | null;
    requiredPace: number | null;
    onTrack: boolean | null;
  }[];
  microsOnTrack: number;
  microsTotal: number;
}

/** Evaluate a Mon–Sun week: per-day success, weekly micro totals vs ×7, and live pace. */
export function evaluateWeek(input: WeekEvalInput): WeekEvalResult {
  const { days, micros, today } = input;
  const complete = days[6].date < today;
  const evalDays = days.filter((d) => d.date <= today);
  const loggedSoFar = evalDays.filter((d) => d.logged).length;

  let kcalDaysHit = 0;
  let protDaysHit = 0;
  let allLoggedSucceeded = true;
  let anyEvaluable = false;
  for (const d of evalDays) {
    if (!d.logged) continue;
    if (!d.target) {
      continue;
    }
    const kcalMax = targetAmount(d.target.values['KCAL'], 'MAX').max;
    const protMin = targetAmount(d.target.values['PROT'], 'MIN').min;
    if (kcalMax !== undefined && (d.totals['KCAL'] ?? 0) <= kcalMax) kcalDaysHit++;
    const ok = daySuccess(d.totals, d.target.values);
    if (ok === null) continue;
    anyEvaluable = true;
    if (protMin !== undefined && (d.totals['PROT'] ?? 0) >= protMin) protDaysHit++;
    if (!ok) allLoggedSucceeded = false;
  }

  const dayTargets = days.map((d) => d.target);
  const microStatus = micros.map((m) => {
    const cumulative = evalDays.reduce((s, d) => s + (d.totals[m.code] ?? 0), 0);
    let requiredWeek: number | null = null;
    {
      let req = 0;
      let any = false;
      for (const t of dayTargets) {
        const amt = targetAmount(t?.values[m.code], m.targetRule);
        const v = m.targetRule === 'MAX' ? amt.max : amt.min;
        if (v !== undefined) {
          req += v;
          any = true;
        }
      }
      requiredWeek = any ? req : null;
    }
    // Pace uses the target in effect today (or the latest day evaluated).
    const current = targetForDateList(dayTargets, days, today);
    const amt = targetAmount(current?.values[m.code], m.targetRule);
    const daily = m.targetRule === 'MAX' ? amt.max : amt.min;
    const requiredPace = daily !== undefined ? daily * loggedSoFar : null;
    let onTrack: boolean | null = null;
    if (requiredPace !== null) {
      onTrack = m.targetRule === 'MAX' ? cumulative <= requiredPace : cumulative >= requiredPace;
    }
    return { code: m.code, cumulative, requiredWeek, requiredPace, onTrack };
  });

  let success: boolean | null = null;
  if (complete && anyEvaluable) {
    const microsOk = microStatus.every((m) => {
      if (m.requiredWeek === null) return true;
      const rule = micros.find((x) => x.code === m.code)!.targetRule;
      return rule === 'MAX' ? m.cumulative <= m.requiredWeek : m.cumulative >= m.requiredWeek;
    });
    success = allLoggedSucceeded && microsOk;
  }

  return {
    complete,
    success,
    loggedDays: loggedSoFar,
    kcalDaysHit,
    protDaysHit,
    microStatus,
    microsOnTrack: microStatus.filter((m) => m.onTrack === true).length,
    microsTotal: micros.length,
  };
}

function targetForDateList(
  dayTargets: (TargetRow | null)[],
  days: { date: string }[],
  today: string
): TargetRow | null {
  let best: TargetRow | null = null;
  for (let i = 0; i < days.length; i++) {
    if (days[i].date <= today && dayTargets[i]) best = dayTargets[i];
  }
  return best ?? dayTargets.find((t) => t !== null) ?? null;
}

/** 7-day EMA over a series of values (chronological). alpha = 2 / (7 + 1). */
export function emaSeries(values: number[], period = 7): number[] {
  const alpha = 2 / (period + 1);
  const out: number[] = [];
  let prev: number | null = null;
  for (const v of values) {
    prev = prev === null ? v : alpha * v + (1 - alpha) * prev;
    out.push(prev);
  }
  return out;
}

/** Slope of the EMA in kg/week, from first to last point. */
export function emaSlopeKgPerWeek(points: { date: string; ema: number }[]): number | null {
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const days =
    (Date.parse(`${last.date}T12:00:00Z`) - Date.parse(`${first.date}T12:00:00Z`)) / 86400000;
  if (days <= 0) return null;
  return ((last.ema - first.ema) / days) * 7;
}

/** Normalize an item name for duplicate detection: lowercase, trimmed, whitespace collapsed. */
export function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}
