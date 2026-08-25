'use client';

import { useMemo } from 'react';
import {
  useMe,
  useDays,
  useSummary,
  useSuggestions,
  useWeights,
  useWeightGoal,
  useNutrients,
} from '@/hooks/useApi';
import { todayInTz, weekDates, monthBounds, addDays } from '@/lib/dates';
import { TodayCard } from '@/components/dashboard/TodayCard';
import { WeekCard } from '@/components/dashboard/WeekCard';
import { SuggestionsCard } from '@/components/dashboard/SuggestionsCard';
import { CalendarStreak } from '@/components/dashboard/CalendarStreak';
import { WeightCard } from '@/components/dashboard/WeightCard';

export default function DashboardPage() {
  const { data: me } = useMe();
  const browserTz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);
  const tz = me?.timezone ?? browserTz;
  const today = todayInTz(tz);
  const week = weekDates(today);
  const { first, last } = monthBounds(today);
  const from = week[0] < first ? week[0] : first;
  const to = last > week[6] ? last : week[6];

  const { data: daysData } = useDays(from, to);
  const { data: summary } = useSummary('7d');
  const { data: suggestionsData } = useSuggestions();
  const { data: weightsData } = useWeights(addDays(today, -89), today);
  const { data: goalData } = useWeightGoal();
  const { data: nutrientsData } = useNutrients();

  if (!me) {
    return <p className="py-8 text-center text-sm text-muted">Loading…</p>;
  }

  const days = daysData?.days ?? [];
  const todayDay = days.find((d) => d.date === today) ?? null;
  const weights = weightsData?.weights ?? [];
  const latestWeightKg = weights.length ? weights[weights.length - 1].valueKg : null;
  const monthDays = days.filter((d) => d.date >= first && d.date <= last);
  const noTargets = todayDay ? todayDay.target === null : false;

  return (
    <>
      <TodayCard me={me} day={todayDay} latestWeightKg={latestWeightKg} />
      {noTargets && (
        <p className="rounded-md border border-hairline bg-card px-3 py-2 text-sm text-muted">
          No targets set yet — head to Settings to set calorie and protein targets, or ask your agent to.
        </p>
      )}
      {summary && nutrientsData && (
        <WeekCard summary={summary} nutrients={nutrientsData.nutrients} weekStart={week[0]} />
      )}
      <SuggestionsCard suggestions={suggestionsData?.suggestions ?? []} />
      <CalendarStreak monthDays={monthDays} today={today} streak={summary?.streak ?? 0} />
      <WeightCard me={me} weights={weights} goal={goalData?.goal ?? null} />
    </>
  );
}
