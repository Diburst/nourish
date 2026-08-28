'use client';

import Link from 'next/link';
import { Card, AgentInvite } from '@/components/ui';
import { AGENT_PROMPTS } from '@/content/agentPrompts';
import type { ApiSuggestion } from '@/types/api';

export function SuggestionsCard({ suggestions, daysLogged = null }: { suggestions: ApiSuggestion[]; daysLogged?: number | null }) {
  if (suggestions.length === 0) {
    // A quiet card for an established account (nothing lagging = good news), an
    // invitation for an empty one.
    if (daysLogged === 0) {
      return (
        <Card title="Suggestions">
          <AgentInvite
            text={AGENT_PROMPTS.shortfalls.text}
            lead="Once some meals are logged, ask your agent:"
          />
        </Card>
      );
    }
    return null;
  }
  return (
    <Card title="Suggestions">
      <ul className="space-y-2.5">
        {suggestions.map((s) => (
          <li key={s.code} className="text-sm">
            <span className="font-medium">{s.displayName}</span>
            <span className="text-muted"> is behind pace</span>
            <span className="mt-0.5 block text-muted">
              {s.links.map((l, i) => (
                <span key={`${l.sectionSlug}-${l.label}`}>
                  {i > 0 && ' · '}
                  <Link href={`/guidelines#${l.sectionSlug}`} className="underline decoration-hairline underline-offset-2">
                    {l.label}
                  </Link>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 border-t border-hairline pt-2 text-xs text-muted">From your guidelines</p>
    </Card>
  );
}
