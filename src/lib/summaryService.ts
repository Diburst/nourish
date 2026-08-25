import { prisma } from '@/lib/prisma';
import { todayInTz, addDays, weekDates, toDateString, parseDateToNoonUTC } from '@/lib/dates';
import { getDaysData, getStreak, loadNutrients, loadTargetRows, UserContext } from '@/lib/dayData';
import { targetForDate, evaluateWeek, emaSeries, emaSlopeKgPerWeek, targetAmount } from '@/lib/scoring';

export interface SummaryOptions {
  rangeDays: 7 | 30 | 90;
}

export async function buildSummary(user: UserContext, opts: SummaryOptions) {
  const today = todayInTz(user.timezone);
  const from = addDays(today, -(opts.rangeDays - 1));
  const [days, nutrients, targets, streak, weights] = await Promise.all([
    getDaysData(user, from, today),
    loadNutrients(user.id),
    loadTargetRows(user.id),
    getStreak(user),
    prisma.weight.findMany({
      where: { userId: user.id, date: { gte: parseDateToNoonUTC(addDays(today, -89)) } },
      orderBy: { date: 'asc' },
    }),
  ]);

  const active = nutrients.filter((n) => !n.archived);
  const micros = active.filter((n) => n.kind === 'MICRO');
  const loggedDays = days.filter((d) => d.logged);

  // Averages over logged days.
  const avg = (code: string) =>
    loggedDays.length
      ? Math.round((loggedDays.reduce((s, d) => s + (d.totals[code] ?? 0), 0) / loggedDays.length) * 10) / 10
      : null;

  // kcal / prot day hits.
  let kcalHits = 0;
  let protHits = 0;
  for (const d of loggedDays) {
    const t = targetForDate(targets, d.date);
    if (!t) continue;
    const kcalMax = targetAmount(t.values['KCAL'], 'MAX').max;
    const protMin = targetAmount(t.values['PROT'], 'MIN').min;
    if (kcalMax !== undefined && (d.totals['KCAL'] ?? 0) <= kcalMax) kcalHits++;
    if (protMin !== undefined && (d.totals['PROT'] ?? 0) >= protMin) protHits++;
  }

  // Per-week micro totals vs ×7 for each Mon–Sun week overlapping the range.
  const weekStarts: string[] = [];
  {
    const seen = new Set<string>();
    for (const d of days) {
      const ws = weekDates(d.date)[0];
      if (!seen.has(ws)) {
        seen.add(ws);
        weekStarts.push(ws);
      }
    }
  }
  const dayByDate = new Map(days.map((d) => [d.date, d]));
  const weeks = [];
  for (const ws of weekStarts) {
    const dates = weekDates(ws);
    const weekDays = await Promise.all(
      dates.map(async (date) => {
        const existing = dayByDate.get(date);
        if (existing) {
          return {
            date,
            logged: existing.logged,
            totals: existing.totals,
            target: targetForDate(targets, date),
          };
        }
        // Edges of the range: treat as unlogged with zero totals (outside range).
        return { date, logged: false, totals: {}, target: targetForDate(targets, date) };
      })
    );
    const evalResult = evaluateWeek({
      days: weekDays as never,
      micros,
      today,
    });
    weeks.push({
      weekStart: ws,
      weekEnd: dates[6],
      ...evalResult,
    });
  }

  // Weight EMA + slope over the last 90 days.
  const weightPoints = weights.map((w) => ({ date: toDateString(w.date), valueKg: Number(w.valueKg) }));
  const ema = emaSeries(weightPoints.map((p) => p.valueKg));
  const emaPoints = weightPoints.map((p, i) => ({ date: p.date, ema: Math.round(ema[i] * 100) / 100 }));
  const slope = emaSlopeKgPerWeek(emaPoints);

  // Current week pace for lagging-micro ranking.
  const thisWeek = weeks.find((w) => w.weekStart === weekDates(today)[0]) ?? null;

  const unloggedDays = days.filter((d) => !d.logged && d.date < today).map((d) => d.date);

  // Top-3 shortfalls: lagging micros by pace ratio.
  const lagging = (thisWeek?.microStatus ?? [])
    .filter((m) => m.onTrack === false)
    .map((m) => ({
      code: m.code,
      displayName: micros.find((x) => x.code === m.code)?.displayName ?? m.code,
      unit: micros.find((x) => x.code === m.code)?.unit ?? '',
      cumulative: Math.round(m.cumulative * 10) / 10,
      requiredPace: m.requiredPace,
      paceRatio:
        m.requiredPace && m.requiredPace > 0
          ? Math.round((m.cumulative / m.requiredPace) * 100) / 100
          : null,
    }))
    .sort((a, b) => (a.paceRatio ?? 0) - (b.paceRatio ?? 0));

  return {
    range: { from, to: today, days: opts.rangeDays },
    daysLogged: loggedDays.length,
    unloggedDays,
    averages: { KCAL: avg('KCAL'), PROT: avg('PROT') },
    kcal: { daysHit: kcalHits, daysLogged: loggedDays.length },
    prot: { daysHit: protHits, daysLogged: loggedDays.length },
    weeks: weeks.map((w) => ({
      weekStart: w.weekStart,
      weekEnd: w.weekEnd,
      complete: w.complete,
      success: w.success,
      loggedDays: w.loggedDays,
      kcalDaysHit: w.kcalDaysHit,
      protDaysHit: w.protDaysHit,
      microsOnTrack: w.microsOnTrack,
      microsTotal: w.microsTotal,
      micros: w.microStatus,
    })),
    streak,
    weight: {
      latestKg: weightPoints.length ? weightPoints[weightPoints.length - 1].valueKg : null,
      ema: emaPoints,
      slopeKgPerWeek: slope !== null ? Math.round(slope * 1000) / 1000 : null,
    },
    topShortfalls: lagging.slice(0, 3),
    laggingMicros: lagging,
  };
}

export interface GuidelineLink {
  label: string;
  nutrients: string[];
  sectionSlug: string;
  sectionTitle: string;
}

/** All current guideline links (latest revision per section), Pantry Staples first, then Meal Ideas. */
export async function currentGuidelineLinks(): Promise<GuidelineLink[]> {
  const sections = await prisma.guidelineSection.findMany({
    orderBy: { sortOrder: 'asc' },
    include: { revisions: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  const priority = (slug: string) => (slug === 'pantry-staples' ? 0 : slug === 'meal-ideas' ? 1 : 2);
  const sorted = [...sections].sort(
    (a, b) => priority(a.slug) - priority(b.slug) || a.sortOrder - b.sortOrder
  );
  const links: GuidelineLink[] = [];
  for (const s of sorted) {
    const rev = s.revisions[0];
    if (!rev) continue;
    const arr = (rev.links as { label: string; nutrients: string[] }[] | null) ?? [];
    for (const l of arr) {
      links.push({ label: l.label, nutrients: l.nutrients ?? [], sectionSlug: s.slug, sectionTitle: s.title });
    }
  }
  return links;
}

/** Suggestions: up to 3 lagging micros, each with up to 2 matching guideline links. */
export async function buildSuggestions(user: UserContext) {
  const summary = await buildSummary(user, { rangeDays: 7 });
  const links = await currentGuidelineLinks();
  const suggestions = summary.laggingMicros
    .map((m) => ({
      ...m,
      links: links.filter((l) => l.nutrients.includes(m.code)).slice(0, 2),
    }))
    .filter((m) => m.links.length > 0)
    .slice(0, 3);
  return { suggestions };
}
