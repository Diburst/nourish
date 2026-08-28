'use client';

import { useState } from 'react';
import { Card, ProgressRow, Modal, EmptyState, ErrorText, TileState, AgentInvite } from '@/components/ui';
import { AGENT_PROMPTS } from '@/content/agentPrompts';
import { InfoDot } from '@/components/Help';
import { fetchApi } from '@/lib/apiClient';
import { useApiMutation, useMealTypes } from '@/hooks/useApi';
import { formatDateLong } from '@/lib/format';
import { displayWeight, displayEnergy, energyUnitLabel } from '@/lib/format';
import type { ApiDay, ApiItem, ApiMeal, Me, TargetValue } from '@/types/api';

function targetMax(v: TargetValue | undefined): number | undefined {
  if (v === undefined) return undefined;
  return typeof v === 'number' ? v : v.max;
}
function targetMin(v: TargetValue | undefined): number | undefined {
  if (v === undefined) return undefined;
  return typeof v === 'number' ? v : v.min;
}

const invalidateKeys = [['days'], ['summary'], ['suggestions'], ['activity']];

export function TodayCard({ me, day, latestWeightKg }: { me: Me; day: ApiDay | null; latestWeightKg: number | null }) {
  const [addOpen, setAddOpen] = useState(false);
  const [addActivityOpen, setAddActivityOpen] = useState(false);
  const [editItem, setEditItem] = useState<{ meal: ApiMeal; item: ApiItem } | null>(null);

  const kcal = day?.totals['KCAL'] ?? 0;
  const prot = day?.totals['PROT'] ?? 0;
  // The baseline renders exactly as it always has; success is evaluated against
  // base + the day's activity adjustment, shown as a separate element beside it.
  const kcalMax = targetMax(day?.target?.['KCAL']);
  const protMin = targetMin(day?.target?.['PROT']);
  const adjKcal = day?.activityAdjustmentKcal ?? 0;
  const adjProt = day?.activityAdjustmentProteinG ?? 0;
  const kcalEffective = targetMax(day?.adjustedTarget?.['KCAL']) ?? kcalMax;
  const protEffective = targetMin(day?.adjustedTarget?.['PROT']) ?? protMin;

  const kcalState: TileState =
    kcalEffective === undefined ? 'none' : kcal > kcalEffective ? 'fail' : 'wip';
  const protState: TileState =
    protEffective === undefined ? 'none' : prot >= protEffective ? 'ok' : 'wip';

  const deleteItem = useApiMutation(
    ({ mealId, itemId }: { mealId: string; itemId: string }) =>
      fetchApi(`/api/meals/${mealId}/items/${itemId}`, { method: 'DELETE' }),
    invalidateKeys
  );
  const deleteActivity = useApiMutation(
    (id: string) => fetchApi(`/api/activities/${id}`, { method: 'DELETE' }),
    invalidateKeys
  );

  return (
    <Card
      title={
        <span>
          Today <span className="ml-1 font-normal text-muted">{day ? formatDateLong(day.date) : ''}</span>
        </span>
      }
      action={
        <div className="flex items-center gap-3">
          {latestWeightKg !== null && (
            <span className="text-sm tabular-nums text-muted">{displayWeight(latestWeightKg, me.weightUnit)}</span>
          )}
          <button className="btn" onClick={() => setAddOpen(true)}>
            Add
          </button>
          <button
            className="text-xs text-muted underline hover:text-ink"
            onClick={() => setAddActivityOpen(true)}
          >
            Activity
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <ProgressRow
          label="Calories"
          value={
            kcalMax !== undefined
              ? `${displayEnergy(kcal, me.energyUnit)} / ${displayEnergy(kcalMax, me.energyUnit)}`
              : displayEnergy(kcal, me.energyUnit)
          }
          extra={
            kcalMax !== undefined && adjKcal > 0 ? (
              <span className="whitespace-nowrap rounded bg-wash px-1 text-xs" data-testid="kcal-adjustment">
                +{displayEnergy(adjKcal, me.energyUnit)} from activity <InfoDot topic="adjustments-vs-targets" />
              </span>
            ) : undefined
          }
          fraction={kcalEffective ? kcal / kcalEffective : 0}
          baselineFraction={
            kcalMax !== undefined && kcalEffective && adjKcal > 0 ? kcalMax / kcalEffective : undefined
          }
          state={kcalState}
        />
        <ProgressRow
          label="Protein"
          value={protMin !== undefined ? `${Math.round(prot)} / ${Math.round(protMin)} g` : `${Math.round(prot)} g`}
          extra={
            protMin !== undefined && adjProt > 0 ? (
              <span className="whitespace-nowrap rounded bg-wash px-1 text-xs" data-testid="prot-adjustment">
                +{adjProt} g from activity
              </span>
            ) : undefined
          }
          fraction={protEffective ? prot / protEffective : 0}
          baselineFraction={
            protMin !== undefined && protEffective && adjProt > 0 ? protMin / protEffective : undefined
          }
          state={protState}
        />
      </div>

      <div className="mt-4 space-y-3">
        {(day?.meals ?? []).filter((m) => m.items.length > 0).length === 0 ? (
          <div>
            <EmptyState>Nothing logged yet today</EmptyState>
            <AgentInvite text={AGENT_PROMPTS.logMeal.text} />
          </div>
        ) : (
          day!.meals
            .filter((m) => m.items.length > 0)
            .map((meal) => (
              <div key={meal.id}>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{meal.mealTypeName}</p>
                <ul className="space-y-0.5">
                  {meal.items.map((item) => (
                    <li key={item.id} className="group flex items-baseline justify-between text-sm">
                      <span>
                        {item.name}
                        {item.quantity !== 1 && <span className="text-muted"> ×{item.quantity}</span>}
                        {item.pinned && (
                          <span className="ml-1 text-xs text-muted" title="Pinned by you">
                            ⌖
                          </span>
                        )}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="invisible flex gap-1 group-hover:visible">
                          <button
                            className="text-xs text-muted underline hover:text-ink"
                            onClick={() => setEditItem({ meal, item })}
                          >
                            Edit
                          </button>
                          <button
                            className="text-xs text-muted underline hover:text-ink"
                            onClick={() => deleteItem.mutate({ mealId: meal.id, itemId: item.id })}
                          >
                            Delete
                          </button>
                        </span>
                        <span className="tabular-nums text-muted">
                          {displayEnergy(item.totals['KCAL'] ?? 0, me.energyUnit)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
        )}
      </div>

      {(day?.activities ?? []).length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Activity</p>
          <ul className="space-y-0.5">
            {day!.activities.map((a) => (
              <li key={a.id} className="group flex items-baseline justify-between text-sm">
                <span>
                  {a.label ?? 'Activity'}
                  {a.minutes !== null && <span className="text-muted"> · {a.minutes} min</span>}
                </span>
                <span className="flex items-center gap-2">
                  <span className="invisible flex gap-1 group-hover:visible">
                    <button
                      className="text-xs text-muted underline hover:text-ink"
                      onClick={() => deleteActivity.mutate(a.id)}
                    >
                      Delete
                    </button>
                  </span>
                  <span className="tabular-nums text-muted">
                    +{displayEnergy(a.kcal, me.energyUnit)}
                    {a.proteinG > 0 && ` · +${a.proteinG} g`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <AddItemModal me={me} date={day?.date ?? null} open={addOpen} onClose={() => setAddOpen(false)} />
      <AddActivityModal
        me={me}
        date={day?.date ?? null}
        open={addActivityOpen}
        onClose={() => setAddActivityOpen(false)}
      />
      {editItem && (
        <EditItemModal
          me={me}
          meal={editItem.meal}
          item={editItem.item}
          onClose={() => setEditItem(null)}
        />
      )}
    </Card>
  );
}

function AddItemModal({ me, date, open, onClose }: { me: Me; date: string | null; open: boolean; onClose: () => void }) {
  const { data: mealTypesData } = useMealTypes();
  const [mealType, setMealType] = useState('LUNCH');
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');

  const add = useApiMutation(
    (input: { mealType: string; name: string; quantity: number; kcal: number; protein: number | null }) =>
      fetchApi('/api/meals', {
        method: 'POST',
        json: {
          ...(date ? { date } : {}),
          mealType: input.mealType,
          items: [
            {
              name: input.name,
              quantity: input.quantity,
              nutrients: { KCAL: input.kcal, ...(input.protein !== null ? { PROT: input.protein } : {}) },
            },
          ],
        },
      }),
    invalidateKeys
  );

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    add.mutate(
      {
        mealType,
        name,
        quantity: Number(quantity) || 1,
        kcal: Number(kcal) || 0,
        protein: protein === '' ? null : Number(protein),
      },
      {
        onSuccess: () => {
          setName('');
          setKcal('');
          setProtein('');
          setQuantity('1');
          onClose();
        },
      }
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="Add item">
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label className="label" htmlFor="add-mealtype">Meal</label>
          <select id="add-mealtype" className="input" value={mealType} onChange={(e) => setMealType(e.target.value)}>
            {(mealTypesData?.mealTypes ?? []).map((mt) => (
              <option key={mt.code} value={mt.code}>
                {mt.displayName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="add-name">Item</label>
          <input id="add-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="label" htmlFor="add-qty">Qty</label>
            <input id="add-qty" className="input" type="number" step="any" min="0.1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="add-kcal">{energyUnitLabel(me.energyUnit)}</label>
            <input id="add-kcal" className="input" type="number" step="any" min="0" value={kcal} onChange={(e) => setKcal(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="add-prot">Protein g</label>
            <input id="add-prot" className="input" type="number" step="any" min="0" value={protein} onChange={(e) => setProtein(e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-muted">Agents fill in the rest later.</p>
        <ErrorText error={add.error} />
        <button type="submit" className="btn-primary w-full" disabled={add.isPending}>
          {add.isPending ? 'Adding…' : 'Add'}
        </button>
      </form>
    </Modal>
  );
}

function EditItemModal({ me, meal, item, onClose }: { me: Me; meal: ApiMeal; item: ApiItem; onClose: () => void }) {
  const [name, setName] = useState(item.name);
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [kcal, setKcal] = useState(String(item.nutrients['KCAL'] ?? ''));
  const [protein, setProtein] = useState(String(item.nutrients['PROT'] ?? ''));

  const save = useApiMutation(
    () =>
      fetchApi(`/api/meals/${meal.id}/items/${item.id}`, {
        method: 'PATCH',
        json: {
          name,
          quantity: Number(quantity) || 1,
          nutrients: {
            ...(kcal !== '' ? { KCAL: Number(kcal) } : {}),
            ...(protein !== '' ? { PROT: Number(protein) } : {}),
          },
        },
      }),
    invalidateKeys
  );

  return (
    <Modal open onClose={onClose} title="Edit item">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined as never, { onSuccess: onClose });
        }}
        className="space-y-3"
      >
        <div>
          <label className="label" htmlFor="edit-name">Item</label>
          <input id="edit-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="label" htmlFor="edit-qty">Qty</label>
            <input id="edit-qty" className="input" type="number" step="any" min="0.1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="edit-kcal">{energyUnitLabel(me.energyUnit)} / unit</label>
            <input id="edit-kcal" className="input" type="number" step="any" min="0" value={kcal} onChange={(e) => setKcal(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="edit-prot">Protein g / unit</label>
            <input id="edit-prot" className="input" type="number" step="any" min="0" value={protein} onChange={(e) => setProtein(e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-muted">Your edit pins this item — agents can no longer change it without an override.</p>
        <ErrorText error={save.error} />
        <button type="submit" className="btn-primary w-full" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </form>
    </Modal>
  );
}

function AddActivityModal({ me, date, open, onClose }: { me: Me; date: string | null; open: boolean; onClose: () => void }) {
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [label, setLabel] = useState('');
  const [minutes, setMinutes] = useState('');

  const add = useApiMutation(
    () =>
      fetchApi('/api/activities', {
        method: 'POST',
        json: {
          ...(date ? { date } : {}),
          kcal: Number(kcal) || 0,
          ...(protein !== '' ? { proteinG: Number(protein) } : {}),
          ...(label.trim() !== '' ? { label: label.trim() } : {}),
          ...(minutes !== '' ? { minutes: Number(minutes) } : {}),
        },
      }),
    invalidateKeys
  );

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    add.mutate(undefined as never, {
      onSuccess: () => {
        setKcal('');
        setProtein('');
        setLabel('');
        setMinutes('');
        onClose();
      },
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="Add activity">
      <form onSubmit={onSubmit} className="space-y-3">
        <p className="text-xs text-muted">
          Bumps today&apos;s calorie and protein allowance only — your everyday targets are unchanged.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="act-kcal">{energyUnitLabel(me.energyUnit)}</label>
            <input id="act-kcal" className="input" type="number" step="1" min="0" max="5000" value={kcal} onChange={(e) => setKcal(e.target.value)} required autoFocus />
          </div>
          <div>
            <label className="label" htmlFor="act-prot">Extra protein g</label>
            <input id="act-prot" className="input" type="number" step="1" min="0" max="300" value={protein} onChange={(e) => setProtein(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="act-label">Label</label>
            <input id="act-label" className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="10k run" />
          </div>
          <div>
            <label className="label" htmlFor="act-min">Minutes</label>
            <input id="act-min" className="input" type="number" step="1" min="1" max="1440" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </div>
        </div>
        <ErrorText error={add.error} />
        <button type="submit" className="btn-primary w-full" disabled={add.isPending}>
          {add.isPending ? 'Adding…' : 'Add activity'}
        </button>
      </form>
    </Modal>
  );
}
