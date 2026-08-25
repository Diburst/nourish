import { describe, it, expect } from 'vitest';
import {
  evaluateRule,
  daySuccess,
  dayStatus,
  successStreak,
  evaluateWeek,
  emaSeries,
  emaSlopeKgPerWeek,
  normalizeName,
  targetForDate,
  TargetRow,
  NutrientDef,
} from '@/lib/scoring';
import {
  parseDateToNoonUTC,
  toDateString,
  dateStringInTz,
  weekDates,
  isoDayOfWeek,
  addDays,
} from '@/lib/dates';
import { lbToKg, kgToLb, kcalToKj, weightToKg } from '@/lib/units';

describe('timezone day assignment', () => {
  it('stores date-only values at noon UTC', () => {
    const d = parseDateToNoonUTC('2026-08-24');
    expect(d.toISOString()).toBe('2026-08-24T12:00:00.000Z');
    expect(toDateString(d)).toBe('2026-08-24');
  });

  it('renders the stored calendar date identically when formatted in UTC', () => {
    const noon = parseDateToNoonUTC('2026-08-24');
    for (const tz of ['Etc/GMT+12', 'America/Los_Angeles', 'Europe/Berlin', 'Asia/Tokyo', 'UTC']) {
      expect(dateStringInTz(noon, tz)).toBe('2026-08-24');
    }
  });

  it('computes "today" per user timezone', () => {
    // 2026-08-25T03:00Z is Aug 24 evening in LA, Aug 25 in Tokyo.
    const instant = new Date('2026-08-25T03:00:00Z');
    expect(dateStringInTz(instant, 'America/Los_Angeles')).toBe('2026-08-24');
    expect(dateStringInTz(instant, 'Asia/Tokyo')).toBe('2026-08-25');
  });

  it('weeks start Monday', () => {
    expect(isoDayOfWeek('2026-08-24')).toBe(1); // a Monday
    expect(weekDates('2026-08-27')[0]).toBe('2026-08-24');
    expect(weekDates('2026-08-24')[6]).toBe('2026-08-30');
  });
});

describe('EMA', () => {
  it('computes a 7-day EMA with alpha 0.25', () => {
    const out = emaSeries([80, 80, 80, 76]);
    expect(out[0]).toBe(80);
    expect(out[2]).toBe(80);
    expect(out[3]).toBeCloseTo(0.25 * 76 + 0.75 * 80, 10);
  });

  it('slope converts to kg/week', () => {
    const slope = emaSlopeKgPerWeek([
      { date: '2026-08-01', ema: 80 },
      { date: '2026-08-15', ema: 79 },
    ]);
    expect(slope).toBeCloseTo(-0.5, 10);
  });
});

describe('MIN/MAX/RANGE evaluation', () => {
  it('MIN: pending until met', () => {
    expect(evaluateRule('MIN', 99, 100)).toBe('pending');
    expect(evaluateRule('MIN', 100, 100)).toBe('met');
  });
  it('MAX: fine until exceeded', () => {
    expect(evaluateRule('MAX', 100, 100)).toBe('pending');
    expect(evaluateRule('MAX', 101, 100)).toBe('exceeded');
  });
  it('RANGE: below/within/above', () => {
    const range = { min: 50, max: 100 };
    expect(evaluateRule('RANGE', 40, range)).toBe('pending');
    expect(evaluateRule('RANGE', 75, range)).toBe('met');
    expect(evaluateRule('RANGE', 101, range)).toBe('exceeded');
  });
});

describe('day success (kcal + prot only)', () => {
  const values = { KCAL: 1800, PROT: 140, MG: 400 };
  it('succeeds when kcal <= target and prot >= target', () => {
    expect(daySuccess({ KCAL: 1800, PROT: 140 }, values)).toBe(true);
  });
  it('fails on kcal over', () => {
    expect(daySuccess({ KCAL: 1801, PROT: 200 }, values)).toBe(false);
  });
  it('fails on prot under', () => {
    expect(daySuccess({ KCAL: 1200, PROT: 139 }, values)).toBe(false);
  });
  it('micros never affect day success', () => {
    expect(daySuccess({ KCAL: 1500, PROT: 150, MG: 0 }, values)).toBe(true);
  });
  it('is null without both kcal and prot targets', () => {
    expect(daySuccess({ KCAL: 1500 }, { KCAL: 1800 })).toBeNull();
  });
});

const target: TargetRow = { effectiveFrom: '2026-01-01', effectiveTo: null, values: { KCAL: 1800, PROT: 140, MG: 400 } };
const micros: NutrientDef[] = [
  { code: 'MG', displayName: 'Magnesium', unit: 'mg', kind: 'MICRO', targetRule: 'MIN', archived: false },
];

function mkWeek(totalsByDay: (Record<string, number> | null)[], today: string) {
  const dates = weekDates('2026-08-17'); // Mon Aug 17 .. Sun Aug 23
  return evaluateWeek({
    days: dates.map((date, i) => ({
      date,
      logged: totalsByDay[i] !== null,
      totals: totalsByDay[i] ?? {},
      target,
    })),
    micros,
    today,
  });
}

describe('week success (×7 flat)', () => {
  const goodDay = { KCAL: 1700, PROT: 150, MG: 500 };
  it('succeeds when all logged days pass and micros reach dailyTarget × 7 regardless of days logged', () => {
    // Only 6 logged days, but MG cumulative = 6 × 500 = 3000 >= 400 × 7 = 2800.
    const week = mkWeek([goodDay, goodDay, goodDay, goodDay, goodDay, goodDay, null], '2026-08-30');
    expect(week.complete).toBe(true);
    expect(week.success).toBe(true);
  });
  it('fails when a logged day failed', () => {
    const badDay = { KCAL: 2500, PROT: 150, MG: 500 };
    const week = mkWeek([goodDay, badDay, goodDay, goodDay, goodDay, goodDay, goodDay], '2026-08-30');
    expect(week.success).toBe(false);
  });
  it('fails when a micro misses ×7 even though every day passed', () => {
    const lowMg = { KCAL: 1700, PROT: 150, MG: 300 }; // 7 × 300 = 2100 < 2800
    const week = mkWeek([lowMg, lowMg, lowMg, lowMg, lowMg, lowMg, lowMg], '2026-08-30');
    expect(week.success).toBe(false);
  });
});

describe('weekly on-track pace', () => {
  it('uses dailyTarget × daysLoggedSoFar', () => {
    const day = { KCAL: 1700, PROT: 150, MG: 450 };
    // Wednesday of that week: 3 logged days, MG cumulative 1350 >= 400 × 3 = 1200.
    const week = mkWeek([day, day, day, null, null, null, null], '2026-08-19');
    const mg = week.microStatus.find((m) => m.code === 'MG')!;
    expect(mg.requiredPace).toBe(1200);
    expect(mg.onTrack).toBe(true);
  });
  it('flags lagging micros', () => {
    const day = { KCAL: 1700, PROT: 150, MG: 100 };
    const week = mkWeek([day, day, day, null, null, null, null], '2026-08-19');
    expect(week.microStatus.find((m) => m.code === 'MG')!.onTrack).toBe(false);
  });
});

describe('success streak', () => {
  const mk = (spec: ('s' | 'f' | 'u' | 'b')[], today: string) =>
    successStreak(
      spec.map((s, i) => ({
        date: addDays(today, i - (spec.length - 1)),
        logged: s !== 'u',
        success: s === 's' ? true : s === 'f' ? false : null,
      })),
      today
    );

  it('counts consecutive successes ending yesterday', () => {
    expect(mk(['f', 's', 's', 's', 'b'], '2026-08-24')).toBe(3); // today blank
  });
  it('resets on a failed day', () => {
    expect(mk(['s', 's', 'f', 's', 'b'], '2026-08-24')).toBe(1);
  });
  it('resets on an unlogged day', () => {
    expect(mk(['s', 's', 'u', 's', 'b'], '2026-08-24')).toBe(1);
  });
  it('extends to today only once today succeeds', () => {
    expect(mk(['s', 's', 's', 's', 'b'], '2026-08-24')).toBe(4);
    expect(mk(['s', 's', 's', 's', 's'], '2026-08-24')).toBe(5);
  });
});

describe('target freeze', () => {
  it('lowering kcal today leaves yesterday ✓ and a 30-day streak intact', () => {
    const today = '2026-08-24';
    const oldRow: TargetRow = { effectiveFrom: '2026-07-01', effectiveTo: '2026-08-23', values: { KCAL: 2000, PROT: 100 } };
    const newRow: TargetRow = { effectiveFrom: today, effectiveTo: null, values: { KCAL: 1500, PROT: 100 } };
    const rows = [oldRow, newRow];

    // Yesterday ate 1900 kcal — passes the OLD target it is joined to, not the new 1500.
    expect(targetForDate(rows, '2026-08-23')).toBe(oldRow);
    expect(
      dayStatus({
        date: '2026-08-23',
        logged: true,
        totals: { KCAL: 1900, PROT: 120 },
        target: targetForDate(rows, '2026-08-23'),
        today,
        accountCreatedDate: '2026-01-01',
      })
    ).toBe('success');

    // 30 days of 1900-kcal successes before the change stay a 30-day streak.
    const days = Array.from({ length: 30 }, (_, i) => {
      const date = addDays(today, i - 30);
      const t = targetForDate(rows, date)!;
      return {
        date,
        logged: true,
        success: daySuccess({ KCAL: 1900, PROT: 120 }, t.values),
      };
    });
    expect(successStreak(days, today)).toBe(30);
  });
});

describe('normalized-name dedupe', () => {
  it('lowercases, trims, collapses whitespace; exact match only', () => {
    expect(normalizeName('  Chicken   Burrito  Bowl ')).toBe('chicken burrito bowl');
    expect(normalizeName('CHICKEN BURRITO BOWL')).toBe('chicken burrito bowl');
    expect(normalizeName('chicken burrito bowls')).not.toBe('chicken burrito bowl');
  });
});

describe('unit conversion', () => {
  it('converts lb ↔ kg exactly', () => {
    expect(lbToKg(165)).toBeCloseTo(74.84, 2);
    expect(kgToLb(lbToKg(165))).toBeCloseTo(165, 10);
    expect(weightToKg(165, 'LB')).toBeCloseTo(74.84, 2);
    expect(weightToKg(74.84, 'KG')).toBeCloseTo(74.84, 10);
  });
  it('converts kcal → kJ', () => {
    expect(kcalToKj(500)).toBeCloseTo(2092, 0);
  });
});
