'use client';

import { useState } from 'react';
import { signOut } from 'next-auth/react';
import { Card, ErrorText, Modal, EmptyState } from '@/components/ui';
import {
  useMe,
  useTargets,
  useCurrentTarget,
  useWeightGoal,
  useNutrients,
  useMealTypes,
  useTokens,
  useApiMutation,
} from '@/hooks/useApi';
import { fetchApi } from '@/lib/apiClient';
import { displayWeight } from '@/lib/format';
import { lbToKg, kgToLb, round1 } from '@/lib/units';
import type { ApiNutrient, ApiTarget, Me } from '@/types/api';

const nutritionKeys = [['days'], ['summary'], ['suggestions'], ['targets'], ['weight-goal'], ['activity'], ['nutrients', false], ['nutrients', true], ['meal-types', false], ['meal-types', true], ['me']];

export default function SettingsPage() {
  const { data: me } = useMe();
  if (!me) return <p className="py-8 text-center text-sm text-muted">Loading…</p>;
  return (
    <>
      <h1 className="text-base font-semibold">Settings</h1>
      <ProfileCard me={me} />
      {me.role !== 'ADMIN' && (
        <>
          <TargetsCard me={me} />
          <NutrientsCard />
          <MealTypesCard />
          <TokensCard />
        </>
      )}
      <SecurityCard />
      {me.role !== 'ADMIN' && <ExportCard />}
      <DangerCard />
    </>
  );
}

function ProfileCard({ me }: { me: Me }) {
  const [name, setName] = useState(me.name);
  const [timezone, setTimezone] = useState(me.timezone);
  const save = useApiMutation(
    (input: Record<string, string>) => fetchApi('/api/me', { method: 'PATCH', json: input }),
    nutritionKeys
  );
  return (
    <Card title="Profile & units">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="p-name">Name</label>
            <input id="p-name" className="input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== me.name && save.mutate({ name })} />
          </div>
          <div>
            <label className="label" htmlFor="p-tz">Timezone</label>
            <input id="p-tz" className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)} onBlur={() => timezone !== me.timezone && save.mutate({ timezone })} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="label">Weight unit</span>
            <div className="flex gap-1">
              {(['LB', 'KG'] as const).map((u) => (
                <button key={u} className={`btn flex-1 ${me.weightUnit === u ? 'bg-page font-medium' : ''}`} onClick={() => save.mutate({ weightUnit: u })}>
                  {u.toLowerCase()}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="label">Energy unit</span>
            <div className="flex gap-1">
              {(['KCAL', 'KJ'] as const).map((u) => (
                <button key={u} className={`btn flex-1 ${me.energyUnit === u ? 'bg-page font-medium' : ''}`} onClick={() => save.mutate({ energyUnit: u })}>
                  {u === 'KCAL' ? 'kcal' : 'kJ'}
                </button>
              ))}
            </div>
          </div>
        </div>
        <ErrorText error={save.error} />
      </div>
    </Card>
  );
}

function TargetsCard({ me }: { me: Me }) {
  const { data: currentData } = useCurrentTarget();
  const { data: targetsData } = useTargets();
  const { data: goalData } = useWeightGoal();
  const { data: nutrientsData } = useNutrients();
  const [editOpen, setEditOpen] = useState(false);
  const [correcting, setCorrecting] = useState<ApiTarget | null>(null);
  const [goalOpen, setGoalOpen] = useState(false);
  const current = currentData?.target ?? null;
  const nutrients = nutrientsData?.nutrients ?? [];

  return (
    <Card
      title="Targets & weight goal"
      action={
        <div className="flex gap-2 text-sm">
          <button className="text-muted underline hover:text-ink" onClick={() => setGoalOpen(true)}>Weight goal</button>
          <button className="text-muted underline hover:text-ink" onClick={() => setEditOpen(true)}>Set targets</button>
        </div>
      }
    >
      {!current ? (
        <EmptyState>No targets yet. Set a calorie ceiling and protein floor to start scoring days.</EmptyState>
      ) : (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          {nutrients
            .filter((n) => current.values[n.code] !== undefined)
            .map((n) => {
              const v = current.values[n.code];
              const shown = typeof v === 'number' ? v : `${v.min}–${v.max}`;
              return (
                <li key={n.code} className="flex justify-between">
                  <span className="text-muted">{n.displayName}</span>
                  <span className="tabular-nums">
                    {n.targetRule === 'MAX' ? '≤ ' : n.targetRule === 'MIN' ? '≥ ' : ''}
                    {shown} {n.unit}
                  </span>
                </li>
              );
            })}
        </ul>
      )}
      {goalData?.goal && (
        <p className="mt-3 border-t border-hairline pt-2 text-sm text-muted">
          Weight goal: {displayWeight(goalData.goal.targetKg, me.weightUnit)} ({goalData.goal.direction.toLowerCase()})
        </p>
      )}
      {(targetsData?.targets.length ?? 0) > 1 && (
        <details className="mt-3 border-t border-hairline pt-2 text-sm">
          <summary className="cursor-pointer text-muted">Past target rows</summary>
          <ul className="mt-2 space-y-1">
            {targetsData!.targets
              .slice()
              .reverse()
              .map((t) => (
                <li key={t.id} className="flex items-center justify-between">
                  <span className="text-muted">
                    {t.effectiveFrom} → {t.effectiveTo ?? 'now'}
                  </span>
                  <button className="text-xs underline" onClick={() => setCorrecting(t)}>
                    correct
                  </button>
                </li>
              ))}
          </ul>
        </details>
      )}
      {editOpen && <TargetEditor nutrients={nutrients} current={current} onClose={() => setEditOpen(false)} />}
      {correcting && <TargetCorrector nutrients={nutrients} target={correcting} onClose={() => setCorrecting(null)} />}
      {goalOpen && <GoalEditor me={me} onClose={() => setGoalOpen(false)} />}
    </Card>
  );
}

function TargetEditor({ nutrients, current, onClose }: { nutrients: ApiNutrient[]; current: ApiTarget | null; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const n of nutrients) {
      const v = current?.values[n.code];
      out[n.code] = v === undefined ? '' : typeof v === 'number' ? String(v) : `${v.min}-${v.max}`;
    }
    return out;
  });
  const save = useApiMutation(() => {
    const payload: Record<string, number | { min: number; max: number }> = {};
    for (const [code, raw] of Object.entries(values)) {
      if (raw.trim() === '') continue;
      if (raw.includes('-')) {
        const [min, max] = raw.split('-').map(Number);
        payload[code] = { min, max };
      } else {
        payload[code] = Number(raw);
      }
    }
    return fetchApi('/api/targets', { method: 'PUT', json: { values: payload } });
  }, nutritionKeys.concat([['targets', 'current']]));

  return (
    <Modal open onClose={onClose} title="Set targets (from today)">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined as never, { onSuccess: onClose });
        }}
        className="space-y-2"
      >
        <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {nutrients.map((n) => (
            <div key={n.code} className="flex items-center gap-2">
              <span className="w-32 shrink-0 text-sm">{n.displayName}</span>
              <input
                className="input"
                placeholder={n.targetRule === 'RANGE' ? 'min-max' : `${n.targetRule.toLowerCase()} ${n.unit}`}
                value={values[n.code] ?? ''}
                onChange={(e) => setValues({ ...values, [n.code]: e.target.value })}
                aria-label={`Target for ${n.displayName}`}
              />
            </div>
          ))}
        </div>
        <p className="text-xs text-muted">Applies from today forward. Past days keep the targets they were scored against.</p>
        <ErrorText error={save.error} />
        <button type="submit" className="btn-primary w-full" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save targets'}
        </button>
      </form>
    </Modal>
  );
}

function TargetCorrector({ nutrients, target, onClose }: { nutrients: ApiNutrient[]; target: ApiTarget; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const n of nutrients) {
      const v = target.values[n.code];
      out[n.code] = v === undefined ? '' : typeof v === 'number' ? String(v) : `${v.min}-${v.max}`;
    }
    return out;
  });
  const save = useApiMutation(() => {
    const payload: Record<string, number | { min: number; max: number }> = {};
    for (const [code, raw] of Object.entries(values)) {
      if (raw.trim() === '') continue;
      if (raw.includes('-')) {
        const [min, max] = raw.split('-').map(Number);
        payload[code] = { min, max };
      } else {
        payload[code] = Number(raw);
      }
    }
    return fetchApi(`/api/targets/${target.id}`, { method: 'PATCH', json: { values: payload } });
  }, nutritionKeys.concat([['targets', 'current']]));

  return (
    <Modal open onClose={onClose} title={`Correct target row (${target.effectiveFrom} → ${target.effectiveTo ?? 'now'})`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined as never, { onSuccess: onClose });
        }}
        className="space-y-2"
      >
        <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {nutrients.map((n) => (
            <div key={n.code} className="flex items-center gap-2">
              <span className="w-32 shrink-0 text-sm">{n.displayName}</span>
              <input
                className="input"
                value={values[n.code] ?? ''}
                onChange={(e) => setValues({ ...values, [n.code]: e.target.value })}
                aria-label={`Corrected target for ${n.displayName}`}
              />
            </div>
          ))}
        </div>
        <p className="text-xs text-muted">Rewrites history for this row — past checkmarks are re-evaluated against the corrected values.</p>
        <ErrorText error={save.error} />
        <button type="submit" className="btn-primary w-full" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Correct row'}
        </button>
      </form>
    </Modal>
  );
}

function GoalEditor({ me, onClose }: { me: Me; onClose: () => void }) {
  const { data: goalData } = useWeightGoal();
  const existing = goalData?.goal ?? null;
  const [value, setValue] = useState(existing ? String(round1(me.weightUnit === 'LB' ? kgToLb(existing.targetKg) : existing.targetKg)) : '');
  const [direction, setDirection] = useState<'LOSE' | 'GAIN' | 'MAINTAIN'>(existing?.direction ?? 'LOSE');
  const save = useApiMutation(
    () =>
      fetchApi('/api/weight-goal', {
        method: 'PUT',
        json: { target: Number(value), weightUnit: me.weightUnit.toLowerCase(), direction },
      }),
    nutritionKeys
  );
  void lbToKg;
  return (
    <Modal open onClose={onClose} title="Weight goal">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined as never, { onSuccess: onClose });
        }}
        className="space-y-3"
      >
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="goal-value">Target ({me.weightUnit.toLowerCase()})</label>
            <input id="goal-value" className="input" type="number" step="any" min="1" value={value} onChange={(e) => setValue(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="goal-dir">Direction</label>
            <select id="goal-dir" className="input" value={direction} onChange={(e) => setDirection(e.target.value as never)}>
              <option value="LOSE">Lose</option>
              <option value="GAIN">Gain</option>
              <option value="MAINTAIN">Maintain</option>
            </select>
          </div>
        </div>
        <ErrorText error={save.error} />
        <button type="submit" className="btn-primary w-full" disabled={save.isPending}>
          Save goal
        </button>
      </form>
    </Modal>
  );
}

function NutrientsCard() {
  const { data } = useNutrients(true);
  const [adding, setAdding] = useState(false);
  const nutrients = data?.nutrients ?? [];
  const toggle = useApiMutation(
    ({ id, archived }: { id: string; archived: boolean }) =>
      fetchApi(`/api/nutrients/${id}`, { method: 'PATCH', json: { archived } }),
    nutritionKeys
  );
  return (
    <Card title="Nutrients" action={<button className="btn" onClick={() => setAdding(true)}>Add</button>}>
      <ul className="divide-y divide-hairline text-sm">
        {nutrients.map((n) => (
          <li key={n.id} className="flex items-center justify-between py-1.5">
            <span className={n.archived ? 'text-muted line-through' : ''}>
              {n.displayName} <span className="text-xs text-muted">({n.code} · {n.targetRule.toLowerCase()} · {n.unit})</span>
            </span>
            {n.code !== 'KCAL' && n.code !== 'PROT' && (
              <button
                className="text-xs text-muted underline hover:text-ink"
                onClick={() => toggle.mutate({ id: n.id, archived: !n.archived })}
              >
                {n.archived ? 'restore' : 'archive'}
              </button>
            )}
          </li>
        ))}
      </ul>
      <ErrorText error={toggle.error} />
      {adding && <AddNutrientModal onClose={() => setAdding(false)} />}
    </Card>
  );
}

function AddNutrientModal({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [unit, setUnit] = useState('mg');
  const [rule, setRule] = useState<'MIN' | 'MAX' | 'RANGE'>('MIN');
  const add = useApiMutation(
    () =>
      fetchApi('/api/nutrients', {
        method: 'POST',
        json: { code: code.toUpperCase(), displayName, unit, kind: 'MICRO', targetRule: rule },
      }),
    nutritionKeys
  );
  return (
    <Modal open onClose={onClose} title="Add nutrient">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate(undefined as never, { onSuccess: onClose });
        }}
        className="space-y-3"
      >
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="n-code">Code</label>
            <input id="n-code" className="input uppercase" value={code} onChange={(e) => setCode(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="n-name">Name</label>
            <input id="n-name" className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="n-unit">Unit</label>
            <input id="n-unit" className="input" value={unit} onChange={(e) => setUnit(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="n-rule">Rule</label>
            <select id="n-rule" className="input" value={rule} onChange={(e) => setRule(e.target.value as never)}>
              <option value="MIN">Min</option>
              <option value="MAX">Max</option>
              <option value="RANGE">Range</option>
            </select>
          </div>
        </div>
        <ErrorText error={add.error} />
        <button type="submit" className="btn-primary w-full" disabled={add.isPending}>
          Add nutrient
        </button>
      </form>
    </Modal>
  );
}

function MealTypesCard() {
  const { data } = useMealTypes(true);
  const [newName, setNewName] = useState('');
  const mealTypes = data?.mealTypes ?? [];
  const rename = useApiMutation(
    ({ id, displayName }: { id: string; displayName: string }) =>
      fetchApi(`/api/meal-types/${id}`, { method: 'PATCH', json: { displayName } }),
    nutritionKeys
  );
  const toggle = useApiMutation(
    ({ id, archived }: { id: string; archived: boolean }) =>
      fetchApi(`/api/meal-types/${id}`, { method: 'PATCH', json: { archived } }),
    nutritionKeys
  );
  const add = useApiMutation(
    () =>
      fetchApi('/api/meal-types', {
        method: 'POST',
        json: { code: newName.toUpperCase().replace(/[^A-Z0-9]+/g, '_'), displayName: newName },
      }),
    nutritionKeys
  );
  return (
    <Card title="Meal types">
      <ul className="divide-y divide-hairline text-sm">
        {mealTypes.map((m) => (
          <li key={m.id} className="flex items-center gap-2 py-1.5">
            <input
              className={`input flex-1 border-transparent bg-transparent px-1 py-0.5 ${m.archived ? 'text-muted line-through' : ''}`}
              defaultValue={m.displayName}
              onBlur={(e) => e.target.value !== m.displayName && rename.mutate({ id: m.id, displayName: e.target.value })}
              aria-label={`Rename ${m.displayName}`}
            />
            <button className="text-xs text-muted underline hover:text-ink" onClick={() => toggle.mutate({ id: m.id, archived: !m.archived })}>
              {m.archived ? 'restore' : 'archive'}
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate(undefined as never, { onSuccess: () => setNewName('') });
        }}
      >
        <input className="input flex-1" placeholder="New meal type" value={newName} onChange={(e) => setNewName(e.target.value)} required />
        <button type="submit" className="btn">Add</button>
      </form>
      <ErrorText error={rename.error || toggle.error || add.error} />
    </Card>
  );
}

function TokensCard() {
  const { data } = useTokens();
  const [name, setName] = useState('');
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const tokens = data?.tokens ?? [];
  const create = useApiMutation(
    () => fetchApi<{ name: string; token: string }>('/api/tokens', { method: 'POST', json: { name } }),
    [['tokens']]
  );
  const revoke = useApiMutation((id: string) => fetchApi(`/api/tokens/${id}`, { method: 'DELETE' }), [['tokens']]);
  return (
    <Card title="API tokens">
      <ul className="divide-y divide-hairline text-sm">
        {tokens.map((t) => (
          <li key={t.id} className="flex items-center justify-between py-1.5">
            <span className={t.revokedAt ? 'text-muted line-through' : ''}>
              {t.name}
              <span className="ml-1 text-xs text-muted">
                {t.scopes.length === 5 ? 'all scopes' : t.scopes.join(', ')} ·{' '}
                {t.lastUsedAt ? `used ${new Date(t.lastUsedAt).toLocaleDateString()}` : 'never used'}
              </span>
            </span>
            {!t.revokedAt && (
              <button className="text-xs text-muted underline hover:text-ink" onClick={() => revoke.mutate(t.id)}>
                revoke
              </button>
            )}
          </li>
        ))}
      </ul>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(undefined as never, {
            onSuccess: (res) => {
              setCreated(res);
              setName('');
            },
          });
        }}
      >
        <input className="input flex-1" placeholder='Token name (e.g. "Claude desktop")' value={name} onChange={(e) => setName(e.target.value)} required />
        <button type="submit" className="btn" disabled={create.isPending}>Create</button>
      </form>
      <ErrorText error={create.error || revoke.error} />
      {created && <TokenCreatedModal created={created} onClose={() => setCreated(null)} />}
    </Card>
  );
}

function CopyRow({ label, value, testId }: { label: string; value: string; testId?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="label">{label}</p>
      <div className="flex items-start gap-2">
        <code className="block flex-1 break-all rounded bg-page p-2 text-xs" data-testid={testId}>
          {value}
        </code>
        <button
          className="btn shrink-0"
          onClick={() => {
            navigator.clipboard?.writeText(value).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              },
              () => {}
            );
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function TokenCreatedModal({ created, onClose }: { created: { name: string; token: string }; onClose: () => void }) {
  const connectorUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/api/mcp/${created.token}` : '';
  return (
    <Modal open onClose={onClose} title={`Connect “${created.name}”`}>
      <div className="space-y-3">
        <p className="text-sm">
          Shown once — copy what you need now. Revoking the token kills both.
        </p>
        <CopyRow
          label="Claude connector URL — paste into Settings → Connectors → Add custom connector (works from a phone; no installs)"
          value={connectorUrl}
          testId="connector-url"
        />
        <CopyRow label="API token — for clients that send an Authorization: Bearer header" value={created.token} testId="token-secret" />
        <p className="text-xs text-muted">
          The URL contains the token, so treat it like a password. If this server is reached over
          your VPN only, claude.ai connectors need the MCP path published (see the README’s
          Tailscale Funnel one-liner).
        </p>
        <button className="btn-primary w-full" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

function SecurityCard() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const change = useApiMutation(
    () => fetchApi('/api/me/password', { method: 'POST', json: { currentPassword, newPassword } }),
    []
  );
  const signOutAll = useApiMutation(() => fetchApi('/api/me/sessions', { method: 'POST' }), []);
  return (
    <Card title="Security & sessions">
      <form
        className="grid grid-cols-[1fr_1fr_auto] gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          change.mutate(undefined as never, {
            onSuccess: () => {
              setCurrentPassword('');
              setNewPassword('');
            },
          });
        }}
      >
        <input className="input" type="password" placeholder="Current password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required aria-label="Current password" />
        <input className="input" type="password" placeholder="New password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={10} aria-label="New password" />
        <button type="submit" className="btn" disabled={change.isPending}>Change</button>
      </form>
      {change.isSuccess && <p className="mt-2 text-sm text-ok-fg">Password changed.</p>}
      <ErrorText error={change.error} />
      <button
        className="btn mt-3"
        onClick={() => signOutAll.mutate(undefined as never, { onSuccess: () => signOut({ callbackUrl: '/login' }) })}
      >
        Sign out on all devices
      </button>
    </Card>
  );
}

function ExportCard() {
  return (
    <Card title="Export">
      <div className="flex gap-2">
        <a className="btn" href="/api/export?format=json" download>
          Download JSON
        </a>
        <a className="btn" href="/api/export?format=csv" download>
          Download CSV
        </a>
      </div>
    </Card>
  );
}

function DangerCard() {
  const [confirming, setConfirming] = useState(false);
  const del = useApiMutation(() => fetchApi('/api/me', { method: 'DELETE' }), []);
  return (
    <Card title="Delete account">
      {!confirming ? (
        <button className="btn text-fail-fg" onClick={() => setConfirming(true)}>
          Delete my account…
        </button>
      ) : (
        <div className="space-y-2">
          <p className="text-sm">This permanently deletes your account and all data under it. There is no undo.</p>
          <div className="flex gap-2">
            <button
              className="btn text-fail-fg"
              disabled={del.isPending}
              onClick={() => del.mutate(undefined as never, { onSuccess: () => signOut({ callbackUrl: '/login' }) })}
            >
              Yes, delete everything
            </button>
            <button className="btn" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
          <ErrorText error={del.error} />
        </div>
      )}
    </Card>
  );
}
