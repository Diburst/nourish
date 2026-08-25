'use client';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public payload?: unknown
  ) {
    super(message);
  }
}

/** Centralized fetch: JSON in/out, typed errors carrying the server's { error } message. */
export async function fetchApi<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: {
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...rest.headers,
    },
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
  });
  if (res.status === 204) return undefined as T;
  let payload: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!res.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: string }).error)
        : `Request failed (${res.status})`;
    throw new ApiError(message, res.status, payload);
  }
  return payload as T;
}

export const queryKeys = {
  me: ['me'] as const,
  days: (from: string, to: string) => ['days', from, to] as const,
  summary: (range: string) => ['summary', range] as const,
  suggestions: ['suggestions'] as const,
  weights: (from: string, to: string) => ['weights', from, to] as const,
  weightGoal: ['weight-goal'] as const,
  targets: ['targets'] as const,
  currentTarget: ['targets', 'current'] as const,
  nutrients: (archived: boolean) => ['nutrients', archived] as const,
  mealTypes: (archived: boolean) => ['meal-types', archived] as const,
  activity: (filters: Record<string, string>) => ['activity', filters] as const,
  guidelines: ['guidelines'] as const,
  guideline: (slug: string) => ['guidelines', slug] as const,
  guidelineRevisions: (slug: string) => ['guidelines', slug, 'revisions'] as const,
  tokens: ['tokens'] as const,
  admin: {
    users: ['admin', 'users'] as const,
    invites: ['admin', 'invites'] as const,
    tokens: ['admin', 'tokens'] as const,
    settings: ['admin', 'settings'] as const,
    backups: ['admin', 'backups'] as const,
    health: ['admin', 'health'] as const,
  },
};
