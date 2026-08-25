'use client';

import { useState } from 'react';
import { Card, ProgressRow, TileState } from '@/components/ui';
import { formatDateShort } from '@/lib/format';
import type { ApiSummary, ApiNutrient } from '@/types/api';

export function WeekCard({
  summary,
  nutrients,
  weekStart,
}: {
  summary: ApiSummary;
  nutrients: ApiNutrient[];
  weekStart: string;
}) {
  const [open, setOpen] = useState(false);
  const week = summary.weeks.find((w) => w.weekStart === weekStart) ?? null;
  if (!week) return null;
  const byCode = new Map(nutrients.map((n) => [n.code, n]));

  const dayState = (hit: number): TileState =>
    week.loggedDays === 0 ? 'none' : hit >= week.loggedDays ? 'ok' : 'wip';

  return (
    <Card
      title={
        <span>
          This week{' '}
          <span className="ml-1 font-normal text-muted">
            {formatDateShort(week.weekStart)} – {formatDateShort(week.weekEnd)} · {week.loggedDays} day
            {week.loggedDays === 1 ? '' : 's'} logged
          </span>
        </span>
      }
    >
      <div className="space-y-3">
        <ProgressRow
          label="Calories"
          value={`${week.kcalDaysHit} / ${week.loggedDays} days`}
          fraction={week.loggedDays ? week.kcalDaysHit / week.loggedDays : 0}
          state={dayState(week.kcalDaysHit)}
        />
        <ProgressRow
          label="Protein"
          value={`${week.protDaysHit} / ${week.loggedDays} days`}
          fraction={week.loggedDays ? week.protDaysHit / week.loggedDays : 0}
          state={dayState(week.protDaysHit)}
        />
      </div>

      <button
        className="mt-3 flex w-full items-center justify-between border-t border-hairline pt-3 text-sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>
          Micronutrients <span className="text-muted">· {week.microsOnTrack} of {week.microsTotal} on track</span>
        </span>
        <span className="text-muted">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {week.micros.map((m) => {
            const n = byCode.get(m.code);
            const state: TileState = m.onTrack === null ? 'none' : m.onTrack ? 'ok' : 'wip';
            return (
              <ProgressRow
                key={m.code}
                label={n?.displayName ?? m.code}
                value={
                  m.requiredWeek !== null
                    ? `${Math.round(m.cumulative * 10) / 10} / ${Math.round(m.requiredWeek * 10) / 10} ${n?.unit ?? ''}`
                    : `${Math.round(m.cumulative * 10) / 10} ${n?.unit ?? ''}`
                }
                fraction={m.requiredWeek ? m.cumulative / m.requiredWeek : 0}
                state={state}
              />
            );
          })}
        </div>
      )}
    </Card>
  );
}
