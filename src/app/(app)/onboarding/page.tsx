'use client';

/**
 * The onboarding wizard. Soft wall: incomplete users land here but may leave via
 * "Explore without an agent" (stamps onboardingSkippedAt). The stepper reflects
 * live status — React Query polls every 3s while incomplete and refetches on
 * window focus, because people tab to Claude and come back.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Card, ErrorText } from '@/components/ui';
import { fetchApi } from '@/lib/apiClient';
import { useAccountStatus, useApiMutation } from '@/hooks/useApi';
import { AGENT_PROMPTS, COMPLETION_PROMPTS } from '@/content/agentPrompts';

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn shrink-0"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard unavailable (http, permissions): select-and-copy fallback is the input itself.
        }
      }}
    >
      {copied ? 'Copied ✓' : label}
    </button>
  );
}

function CopyablePrompt({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 rounded bg-page px-2 py-1.5 text-xs leading-relaxed">{text}</code>
      <CopyButton text={text} />
    </div>
  );
}

function StepBadge({ done, index }: { done: boolean; index: number }) {
  return (
    <span
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
        done ? 'bg-ok-bg text-ok-fg' : 'bg-wash text-muted'
      }`}
      aria-label={done ? 'Step complete' : `Step ${index}`}
    >
      {done ? '✓' : index}
    </span>
  );
}

function Step({
  index,
  done,
  title,
  keepOpenWhenDone = false,
  children,
}: {
  index: number;
  done: boolean;
  title: string;
  /** Step 1 keeps its content visible after completing — the token is shown once. */
  keepOpenWhenDone?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <StepBadge done={done} index={index} />
        {index < 4 && <div className="mt-1 w-px flex-1 bg-hairline" aria-hidden />}
      </div>
      <div className="min-w-0 flex-1 pb-5">
        <p className={`text-sm font-medium ${done ? 'text-muted line-through decoration-hairline' : ''}`}>{title}</p>
        {(!done || keepOpenWhenDone) && children && <div className="mt-2 space-y-2">{children}</div>}
      </div>
    </li>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: status } = useAccountStatus({ poll: true });
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [tokenName, setTokenName] = useState('Claude');

  const createToken = useApiMutation(
    () => fetchApi<{ token: string }>('/api/tokens', { method: 'POST', json: { name: tokenName || 'Claude' } }),
    [['tokens'], ['account-status']]
  );
  const skip = useApiMutation(() => fetchApi('/api/onboarding/skip', { method: 'POST', json: {} }), [
    ['account-status'],
  ]);

  const steps = status?.steps;
  const allDone = Boolean(steps && steps.token && steps.paired && steps.targets && steps.weight);
  const mcpUrl =
    status?.mcpPublicUrl ?? (typeof window !== 'undefined' ? `${window.location.origin}/api/mcp` : '/api/mcp');

  return (
    <div className="space-y-4">
      <Card title="Welcome to Nourish">
        <p className="text-sm leading-relaxed">
          Nourish has no food diary. You tell your agent what you ate; this is where you see what it means.
        </p>
        <div className="mt-4 flex items-center justify-between gap-2 text-center text-xs text-muted">
          <div className="onb-beat flex-1 rounded-md bg-wash px-2 py-3">
            <span className="block text-lg" aria-hidden>💬</span>
            You talk to your agent
          </div>
          <span className="onb-arrow" aria-hidden>→</span>
          <div className="onb-beat flex-1 rounded-md bg-wash px-2 py-3">
            <span className="block text-lg" aria-hidden>🍃</span>
            Your agent writes to Nourish
          </div>
          <span className="onb-arrow" aria-hidden>→</span>
          <div className="onb-beat flex-1 rounded-md bg-wash px-2 py-3">
            <span className="block text-lg" aria-hidden>📈</span>
            You read the trends
          </div>
        </div>
      </Card>

      {allDone ? (
        <Card title="You're set up 🎉">
          <p className="text-sm leading-relaxed">
            Your agent is paired and your first numbers are in. Try these next — say them to your agent:
          </p>
          <div className="mt-3 space-y-2">
            {COMPLETION_PROMPTS.map((p) => (
              <CopyablePrompt key={p.id} text={p.text} />
            ))}
          </div>
          <button className="btn-primary mt-4 w-full" onClick={() => router.push('/dashboard')}>
            Go to your dashboard
          </button>
        </Card>
      ) : (
        <Card title="Set up in four steps">
          <ol className="mt-1">
            <Step index={1} done={Boolean(steps?.token)} keepOpenWhenDone={createdToken !== null} title="Create a token">
              {createdToken ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <code className="flex-1 break-all rounded bg-page px-2 py-1.5 text-xs">{createdToken}</code>
                    <CopyButton text={createdToken} />
                  </div>
                  <p className="text-xs text-muted">
                    Shown once — treat it like a password. You&apos;ll paste it in step 2.
                  </p>
                </div>
              ) : (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    createToken.mutate(undefined as never, {
                      onSuccess: (data) => setCreatedToken((data as { token: string }).token),
                    });
                  }}
                >
                  <input
                    className="input flex-1"
                    value={tokenName}
                    onChange={(e) => setTokenName(e.target.value)}
                    aria-label="Token name"
                    placeholder="Token name"
                  />
                  <button type="submit" className="btn-primary shrink-0" disabled={createToken.isPending}>
                    {createToken.isPending ? 'Creating…' : 'Create token'}
                  </button>
                </form>
              )}
              <ErrorText error={createToken.error} />
            </Step>

            <Step index={2} done={Boolean(steps?.paired)} title="Pair your agent">
              <ol className="list-decimal space-y-1 pl-4 text-xs leading-relaxed text-muted">
                <li>
                  In Claude: Settings → Connectors → <span className="text-ink">Add custom connector</span>
                </li>
                <li>
                  Paste this URL and <span className="text-ink">leave the OAuth fields blank</span>:
                </li>
              </ol>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-page px-2 py-1.5 text-xs">{mcpUrl}</code>
                <CopyButton text={mcpUrl} />
              </div>
              <ol start={3} className="list-decimal space-y-1 pl-4 text-xs leading-relaxed text-muted">
                <li>Paste your token on the consent page and hit Allow</li>
              </ol>
              <p className="flex items-center gap-1.5 text-xs text-muted" data-testid="waiting-for-agent">
                <span className="onb-waiting-dot inline-block h-2 w-2 rounded-full bg-wip-fg" aria-hidden />
                Waiting for your agent… this flips green the moment it makes its first call.
              </p>
              <details className="text-xs text-muted">
                <summary className="cursor-pointer">Trouble connecting?</summary>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  <li>
                    &ldquo;Couldn&apos;t reach the MCP server&rdquo; — discovery failed: re-check the URL above.
                  </li>
                  <li>
                    &ldquo;Couldn&apos;t register with sign-in service&rdquo; — the registration call failed: check that
                    /oauth and /.well-known are published (funnel mounts).
                  </li>
                </ul>
              </details>
            </Step>

            <Step index={3} done={Boolean(steps?.targets)} title="Set your targets">
              <p className="text-xs text-muted">Paste this into Claude (adjust the numbers to yours):</p>
              <CopyablePrompt text={AGENT_PROMPTS.setTargets.text} />
            </Step>

            <Step index={4} done={Boolean(steps?.weight)} title="Log your first weight">
              <p className="text-xs text-muted">Same pattern:</p>
              <CopyablePrompt text={AGENT_PROMPTS.logWeight.text} />
            </Step>
          </ol>

          {!status?.skipped && (
            <p className="mt-1 text-center">
              <button
                className="text-xs text-muted underline hover:text-ink"
                onClick={() =>
                  skip.mutate(undefined as never, {
                    onSuccess: () => {
                      // Update the cache synchronously so the gate doesn't bounce the
                      // navigation back here before the refetch lands.
                      qc.setQueryData(['account-status'], (old: unknown) =>
                        old ? { ...(old as object), skipped: true } : old
                      );
                      qc.invalidateQueries({ queryKey: ['account-status'] });
                      router.push('/dashboard');
                    },
                  })
                }
              >
                Explore without an agent
              </button>
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
