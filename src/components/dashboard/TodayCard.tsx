'use client';

import { useState } from 'react';
import { Card, ProgressRow, Modal, EmptyState, ErrorText, TileState } from '@/components/ui';
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
  const [editItem, setEditItem] = useState<{ meal: ApiMeal; item: ApiItem } | null>(null);

  const kcal = day?.totals['KCAL'] ?? 0;
  const prot = day?.totals['PROT'] ?? 0;
  const kcalMax = targetMax(day?.target?.['KCAL']);
  const protMin = targetMin(day?.target?.['PROT']);

  const kcalState: TileState =
    kcalMax === undefined ? 'none' : kcal > kcalMax ? 'fail' : 'wip';
  const protState: TileState =
    protMin === undefined ? 'none' : prot >= protMin ? 'ok' : 'wip';

  const deleteItem = useApiMutation(
    ({ mealId, itemId }: { mealId: string; itemId: string }) =>
      fetchApi(`/api/meals/${mealId}/items/${itemId}`, { method: 'DELETE' }),
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
          fraction={kcalMax ? kcal / kcalMax : 0}
          state={kcalState}
        />
        <ProgressRow
          label="Protein"
          value={protMin !== undefined ? `${Math.round(prot)} / ${Math.round(protMin)} g` : `${Math.round(prot)} g`}
          fraction={protMin ? prot / protMin : 0}
          state={protState}
        />
      </div>

      <div className="mt-4 space-y-3">
        {(day?.meals ?? []).filter((m) => m.items.length > 0).length === 0 ? (
          <EmptyState>Nothing logged yet today</EmptyState>
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

      <AddItemModal me={me} date={day?.date ?? null} open={addOpen} onClose={() => setAddOpen(false)} />
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
