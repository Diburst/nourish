import { toDateString } from '@/lib/dates';

export function serializeTarget(t: {
  id: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  values: unknown;
  source: string;
  createdAt: Date;
}) {
  return {
    id: t.id,
    effectiveFrom: toDateString(t.effectiveFrom),
    effectiveTo: t.effectiveTo ? toDateString(t.effectiveTo) : null,
    values: t.values as Record<string, number | { min: number; max: number }>,
    source: t.source,
    createdAt: t.createdAt.toISOString(),
  };
}

export function serializeWeightGoal(g: {
  id: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  targetKg: unknown;
  direction: string;
  source: string;
  createdAt: Date;
}) {
  return {
    id: g.id,
    effectiveFrom: toDateString(g.effectiveFrom),
    effectiveTo: g.effectiveTo ? toDateString(g.effectiveTo) : null,
    targetKg: Number(g.targetKg),
    direction: g.direction,
    source: g.source,
    createdAt: g.createdAt.toISOString(),
  };
}

export function serializeNutrient(n: {
  id: string;
  code: string;
  displayName: string;
  unit: string;
  kind: string;
  targetRule: string;
  sortOrder: number;
  archivedAt: Date | null;
}) {
  return {
    id: n.id,
    code: n.code,
    displayName: n.displayName,
    unit: n.unit,
    kind: n.kind,
    targetRule: n.targetRule,
    sortOrder: n.sortOrder,
    archived: n.archivedAt !== null,
  };
}

export function serializeMealType(m: {
  id: string;
  code: string;
  displayName: string;
  sortOrder: number;
  archivedAt: Date | null;
}) {
  return {
    id: m.id,
    code: m.code,
    displayName: m.displayName,
    sortOrder: m.sortOrder,
    archived: m.archivedAt !== null,
  };
}

export function serializeRevision(r: {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  before: unknown;
  after: unknown;
  actorType: string;
  actorId: string;
  override: boolean;
  createdAt: Date;
}) {
  return {
    id: r.id,
    entityType: r.entityType,
    entityId: r.entityId,
    action: r.action,
    before: r.before,
    after: r.after,
    actorType: r.actorType,
    actorId: r.actorId,
    override: r.override,
    createdAt: r.createdAt.toISOString(),
  };
}
