'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi, queryKeys } from '@/lib/apiClient';
import type {
  Me,
  ApiDay,
  ApiSummary,
  ApiSuggestion,
  ApiWeight,
  ApiWeightGoal,
  ApiNutrient,
  ApiMealType,
  ApiTarget,
  ApiRevision,
  ApiGuidelineSection,
  ApiToken,
} from '@/types/api';

export function useMe() {
  return useQuery({ queryKey: queryKeys.me, queryFn: () => fetchApi<Me>('/api/me') });
}

export function useDays(from: string, to: string) {
  return useQuery({
    queryKey: queryKeys.days(from, to),
    queryFn: () => fetchApi<{ days: ApiDay[] }>(`/api/days?from=${from}&to=${to}`),
  });
}

export function useSummary(range: '7d' | '30d' | '90d' = '7d') {
  return useQuery({
    queryKey: queryKeys.summary(range),
    queryFn: () => fetchApi<ApiSummary>(`/api/summary?range=${range}`),
  });
}

export function useSuggestions() {
  return useQuery({
    queryKey: queryKeys.suggestions,
    queryFn: () => fetchApi<{ suggestions: ApiSuggestion[] }>('/api/suggestions'),
  });
}

export function useWeights(from: string, to: string) {
  return useQuery({
    queryKey: queryKeys.weights(from, to),
    queryFn: () => fetchApi<{ weights: ApiWeight[] }>(`/api/weights?from=${from}&to=${to}`),
  });
}

export function useWeightGoal() {
  return useQuery({
    queryKey: queryKeys.weightGoal,
    queryFn: () => fetchApi<{ goal: ApiWeightGoal | null; history: ApiWeightGoal[] }>('/api/weight-goal'),
  });
}

export function useNutrients(archived = false) {
  return useQuery({
    queryKey: queryKeys.nutrients(archived),
    queryFn: () => fetchApi<{ nutrients: ApiNutrient[] }>(`/api/nutrients${archived ? '?archived=true' : ''}`),
  });
}

export function useMealTypes(archived = false) {
  return useQuery({
    queryKey: queryKeys.mealTypes(archived),
    queryFn: () => fetchApi<{ mealTypes: ApiMealType[] }>(`/api/meal-types${archived ? '?archived=true' : ''}`),
  });
}

export function useTargets() {
  return useQuery({
    queryKey: queryKeys.targets,
    queryFn: () => fetchApi<{ targets: ApiTarget[] }>('/api/targets'),
  });
}

export function useCurrentTarget() {
  return useQuery({
    queryKey: queryKeys.currentTarget,
    queryFn: () => fetchApi<{ target: ApiTarget | null }>('/api/targets/current'),
  });
}

export function useActivity(filters: Record<string, string>, cursor: string | null) {
  const params = new URLSearchParams(filters);
  if (cursor) params.set('cursor', cursor);
  return useQuery({
    queryKey: [...queryKeys.activity(filters), cursor],
    queryFn: () =>
      fetchApi<{ revisions: ApiRevision[]; nextCursor: string | null }>(`/api/activity?${params}`),
  });
}

export function useGuidelines() {
  return useQuery({
    queryKey: queryKeys.guidelines,
    queryFn: () => fetchApi<{ sections: ApiGuidelineSection[] }>('/api/guidelines'),
  });
}

export function useTokens() {
  return useQuery({
    queryKey: queryKeys.tokens,
    queryFn: () => fetchApi<{ tokens: ApiToken[] }>('/api/tokens'),
  });
}

/** Single source of truth: after any nutrition mutation, invalidate — never hand-patch caches. */
export function useInvalidateNutrition() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['days'] });
    qc.invalidateQueries({ queryKey: ['summary'] });
    qc.invalidateQueries({ queryKey: ['suggestions'] });
    qc.invalidateQueries({ queryKey: ['weights'] });
    qc.invalidateQueries({ queryKey: ['activity'] });
  };
}

export function useApiMutation<TInput, TOutput = unknown>(
  fn: (input: TInput) => Promise<TOutput>,
  invalidate: readonly unknown[][]
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of invalidate) qc.invalidateQueries({ queryKey: key });
    },
  });
}
