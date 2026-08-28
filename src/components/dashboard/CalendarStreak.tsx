'use client';

import { Card } from '@/components/ui';
import { isoDayOfWeek, monthBounds, dateRange, parseDateToNoonUTC } from '@/lib/dates';
import type { ApiDay } from '@/types/api';

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function CalendarStreak({
  monthDays,
  today,
  streak,
}: {
  monthDays: ApiDay[];
  today: string;
  streak: number;
}) {
  const { first, last } = monthBounds(today);
  const byDate = new Map(monthDays.map((d) => [d.date, d]));
  const dates = dateRange(first, last);
  const leading = isoDayOfWeek(first) - 1;
  const monthName = parseDateToNoonUTC(today).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <div className="grid grid-cols-[3fr_2fr] gap-4">
      <Card title={monthName}>
        <div className="grid grid-cols-7 gap-1 text-center">
          {DOW.map((d, i) => (
            <div key={`${d}${i}`} className="text-[10px] font-medium text-muted">
              {d}
            </div>
          ))}
          {Array.from({ length: leading }).map((_, i) => (
            <div key={`pad-${i}`} />
          ))}
          {dates.map((date) => {
            const day = byDate.get(date);
            const status = date === today ? (day?.logged ? 'pending' : 'today') : (day?.status ?? 'blank');
            const cls =
              status === 'success'
                ? 'bg-ok-bg text-ok-fg'
                : status === 'fail'
                  ? 'bg-fail-bg text-fail-fg'
                  : status === 'pending'
                    ? 'bg-wip-bg text-wip-fg'
                    : 'text-muted';
            const glyph =
              status === 'success' ? '✓' : status === 'fail' ? '✕' : status === 'pending' ? '⏱' : '';
            const dayNum = Number(date.slice(8, 10));
            return (
              <div
                key={date}
                className={`flex aspect-square flex-col items-center justify-center rounded text-[10px] ${cls} ${
                  date === today ? 'ring-1 ring-barfill' : ''
                }`}
                title={
                  day && day.activityAdjustmentKcal > 0
                    ? `${date} · +${day.activityAdjustmentKcal} kcal from activity${
                        day.activityAdjustmentProteinG > 0 ? `, +${day.activityAdjustmentProteinG} g protein` : ''
                      }`
                    : date
                }
              >
                <span className="leading-none">{dayNum}</span>
                {glyph && <span className="text-[9px] leading-tight">{glyph}</span>}
              </div>
            );
          })}
        </div>
      </Card>
      <Card title="Success streak">
        <div className="flex h-full flex-col items-center justify-center pb-2">
          <span className="text-5xl font-semibold tabular-nums" data-testid="streak">
            {streak}
          </span>
          <span className="mt-1 text-xs text-muted">day{streak === 1 ? '' : 's'}</span>
        </div>
      </Card>
    </div>
  );
}
