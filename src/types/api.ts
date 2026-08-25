export interface Me {
  id: string;
  email: string;
  name: string;
  role: 'USER' | 'ADMIN';
  timezone: string;
  weightUnit: 'LB' | 'KG';
  energyUnit: 'KCAL' | 'KJ';
  mustChangePassword: boolean;
  createdAt: string;
}

export interface ApiItem {
  id: string;
  name: string;
  quantity: number;
  notes: string | null;
  nutrients: Record<string, number>;
  totals: Record<string, number>;
  pinned: boolean;
  source: string;
  tokenId: string | null;
}

export interface ApiMeal {
  id: string;
  date: string;
  mealType: string;
  mealTypeName: string;
  notes: string | null;
  items: ApiItem[];
  totals: Record<string, number>;
}

export type DayStatus = 'success' | 'fail' | 'pending' | 'blank';
export type TargetValue = number | { min: number; max: number };

export interface ApiDay {
  date: string;
  logged: boolean;
  status: DayStatus;
  totals: Record<string, number>;
  target: Record<string, TargetValue> | null;
  weightKg: number | null;
  meals: ApiMeal[];
}

export interface ApiNutrient {
  id: string;
  code: string;
  displayName: string;
  unit: string;
  kind: 'ENERGY' | 'MACRO' | 'MICRO';
  targetRule: 'MIN' | 'MAX' | 'RANGE';
  sortOrder: number;
  archived: boolean;
}

export interface ApiMealType {
  id: string;
  code: string;
  displayName: string;
  sortOrder: number;
  archived: boolean;
}

export interface ApiTarget {
  id: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  values: Record<string, TargetValue>;
  source: string;
  createdAt: string;
}

export interface ApiWeightGoal {
  id: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  targetKg: number;
  direction: 'LOSE' | 'GAIN' | 'MAINTAIN';
  source: string;
  createdAt: string;
}

export interface ApiWeight {
  id: string;
  date: string;
  valueKg: number;
  pinned: boolean;
  source: string;
  loggedAt: string;
}

export interface MicroStatus {
  code: string;
  cumulative: number;
  requiredWeek: number | null;
  requiredPace: number | null;
  onTrack: boolean | null;
}

export interface ApiSummary {
  range: { from: string; to: string; days: number };
  daysLogged: number;
  unloggedDays: string[];
  averages: { KCAL: number | null; PROT: number | null };
  kcal: { daysHit: number; daysLogged: number };
  prot: { daysHit: number; daysLogged: number };
  weeks: {
    weekStart: string;
    weekEnd: string;
    complete: boolean;
    success: boolean | null;
    loggedDays: number;
    kcalDaysHit: number;
    protDaysHit: number;
    microsOnTrack: number;
    microsTotal: number;
    micros: MicroStatus[];
  }[];
  streak: number;
  weight: {
    latestKg: number | null;
    ema: { date: string; ema: number }[];
    slopeKgPerWeek: number | null;
  };
  topShortfalls: {
    code: string;
    displayName: string;
    unit: string;
    cumulative: number;
    requiredPace: number | null;
    paceRatio: number | null;
  }[];
}

export interface ApiSuggestion {
  code: string;
  displayName: string;
  unit: string;
  cumulative: number;
  requiredPace: number | null;
  paceRatio: number | null;
  links: { label: string; nutrients: string[]; sectionSlug: string; sectionTitle: string }[];
}

export interface ApiRevision {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  before: unknown;
  after: unknown;
  actorType: 'USER' | 'TOKEN';
  actorId: string;
  actorName: string;
  override: boolean;
  createdAt: string;
}

export interface ApiGuidelineSection {
  slug: string;
  title: string;
  sortOrder: number;
  body: string;
  links: { label: string; nutrients: string[] }[];
  editedBy: string | null;
  editedAt: string | null;
  revisionId: string | null;
}

export interface ApiToken {
  id: string;
  name: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}
