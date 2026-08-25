'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, EmptyState } from '@/components/ui';
import { useActivity, useTokens } from '@/hooks/useApi';
import { formatRelative } from '@/lib/format';
import type { ApiRevision } from '@/types/api';

const ENTITY_TYPES = ['MEAL', 'MEAL_ITEM', 'WEIGHT', 'TARGET', 'WEIGHT_GOAL', 'NUTRIENT', 'MEAL_TYPE'];

function actionLabel(r: ApiRevision): string {
  const entity = r.entityType.toLowerCase().replace('_', ' ');
  const verbs: Record<string, string> = {
    CREATE: 'added',
    UPDATE: 'updated',
    DELETE: 'deleted',
    RESTORE: 'restored',
    ARCHIVE: 'archived',
    CORRECT: 'corrected',
  };
  return `${verbs[r.action] ?? r.action.toLowerCase()} a ${entity}`;
}

function DiffView({ before, after }: { before: unknown; after: unknown }) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
      <div>
        <p className="mb-1 font-medium text-muted">Before</p>
        <pre className="overflow-x-auto rounded bg-page p-2">{before ? JSON.stringify(before, null, 1) : '—'}</pre>
      </div>
      <div>
        <p className="mb-1 font-medium text-muted">After</p>
        <pre className="overflow-x-auto rounded bg-page p-2">{after ? JSON.stringify(after, null, 1) : '—'}</pre>
      </div>
    </div>
  );
}

export default function LogPage() {
  const [actor, setActor] = useState('agents'); // default filter: agents only
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [pages, setPages] = useState<ApiRevision[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const qc = useQueryClient();

  const filters: Record<string, string> = {
    ...(actor ? { actor } : {}),
    ...(entityType ? { entityType } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
  const { data, isFetching } = useActivity(filters, cursor);
  const { data: tokensData } = useTokens();

  const rows = cursor === null ? (data?.revisions ?? []) : [...pages, ...(data?.revisions ?? [])];

  function resetFilters(fn: () => void) {
    fn();
    setCursor(null);
    setPages([]);
    qc.invalidateQueries({ queryKey: ['activity'] });
  }

  return (
    <Card title="Log">
      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        <select className="input w-auto" value={actor} onChange={(e) => resetFilters(() => setActor(e.target.value))}>
          <option value="agents">Agents only</option>
          <option value="">Everyone</option>
          <option value="user">You only</option>
          {(tokensData?.tokens ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select
          className="input w-auto"
          value={entityType}
          onChange={(e) => resetFilters(() => setEntityType(e.target.value))}
        >
          <option value="">All types</option>
          {ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.toLowerCase().replace('_', ' ')}
            </option>
          ))}
        </select>
        <input type="date" className="input w-auto" value={from} onChange={(e) => resetFilters(() => setFrom(e.target.value))} />
        <input type="date" className="input w-auto" value={to} onChange={(e) => resetFilters(() => setTo(e.target.value))} />
      </div>

      {rows.length === 0 && !isFetching ? (
        <EmptyState>No activity yet</EmptyState>
      ) : (
        <ul className="divide-y divide-hairline">
          {rows.map((r) => (
            <li key={r.id} className="py-2">
              <button className="w-full text-left" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span>
                    <span className="font-medium">{r.actorName}</span> {actionLabel(r)}
                    {r.override && <span className="ml-1.5 rounded bg-wip-bg px-1 py-0.5 text-[10px] text-wip-fg">override</span>}
                  </span>
                  <span className="whitespace-nowrap text-xs text-muted">{formatRelative(r.createdAt)}</span>
                </div>
              </button>
              {expanded === r.id && <DiffView before={r.before} after={r.after} />}
            </li>
          ))}
        </ul>
      )}

      {data?.nextCursor && (
        <button
          className="btn mt-3 w-full"
          disabled={isFetching}
          onClick={() => {
            setPages(rows);
            setCursor(data.nextCursor);
          }}
        >
          {isFetching ? 'Loading…' : 'Load more'}
        </button>
      )}
    </Card>
  );
}
