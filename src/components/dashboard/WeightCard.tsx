'use client';

import { Card, EmptyState, AgentInvite } from '@/components/ui';
import { AGENT_PROMPTS } from '@/content/agentPrompts';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Scatter,
  XAxis,
  YAxis,
  ReferenceLine,
  Tooltip,
} from 'recharts';
import { weightNumber, displayWeight, formatDateShort } from '@/lib/format';
import type { ApiWeight, ApiWeightGoal, Me } from '@/types/api';

/** 7-day EMA over the raw series (client-side mirror of the server math). */
function ema(values: number[], period = 7): number[] {
  const alpha = 2 / (period + 1);
  const out: number[] = [];
  let prev: number | null = null;
  for (const v of values) {
    prev = prev === null ? v : alpha * v + (1 - alpha) * prev;
    out.push(prev);
  }
  return out;
}

export function WeightCard({
  me,
  weights,
  goal,
}: {
  me: Me;
  weights: ApiWeight[];
  goal: ApiWeightGoal | null;
}) {
  const unit = me.weightUnit;
  const emaValues = ema(weights.map((w) => weightNumber(w.valueKg, unit)));
  const data = weights.map((w, i) => ({
    date: w.date,
    raw: weightNumber(w.valueKg, unit),
    ema: Math.round(emaValues[i] * 10) / 10,
  }));
  const goalValue = goal ? weightNumber(goal.targetKg, unit) : null;

  return (
    <Card
      title="Weight"
      action={
        goal ? (
          <span className="text-sm text-muted">goal {displayWeight(goal.targetKg, unit)}</span>
        ) : undefined
      }
    >
      {data.length === 0 ? (
        <div>
          <EmptyState>No weights yet</EmptyState>
          <AgentInvite text={AGENT_PROMPTS.logWeight.text} />
        </div>
      ) : (
        <div className="h-44 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: -14 }}>
              <XAxis
                dataKey="date"
                tickFormatter={formatDateShort}
                tick={{ fontSize: 10, fill: '#8A8880' }}
                tickLine={false}
                axisLine={{ stroke: '#E7E5E1' }}
                minTickGap={40}
              />
              <YAxis
                domain={['auto', 'auto']}
                tick={{ fontSize: 10, fill: '#8A8880' }}
                tickLine={false}
                axisLine={false}
                width={44}
              />
              <Tooltip
                formatter={(value: number, name: string) => [
                  `${value} ${unit === 'LB' ? 'lb' : 'kg'}`,
                  name === 'ema' ? 'trend' : 'logged',
                ]}
                labelFormatter={formatDateShort}
                contentStyle={{ fontSize: 12, border: '1px solid #E7E5E1', borderRadius: 6 }}
              />
              <Scatter dataKey="raw" fill="#D6D4CE" shape="circle" legendType="none" />
              <Line type="monotone" dataKey="ema" stroke="#9C9A92" strokeWidth={2} dot={false} />
              {goalValue !== null && (
                <ReferenceLine y={goalValue} stroke="#9C9A92" strokeDasharray="5 4" strokeWidth={1} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
