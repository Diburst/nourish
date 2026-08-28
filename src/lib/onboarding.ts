/**
 * One source of truth for "does this account work": the setup steps AND the live
 * connection state, from a single function. The redirect, both banners, the
 * /onboarding stepper and the MCP _hint plumbing all read this — nothing else
 * derives its own opinion.
 *
 * Two separate mechanisms, deliberately:
 * - `onboardingCompletedAt` is a LATCH: once setup completes it never re-runs (a
 *   soft-deleted weight entry must not throw a returning user back to step four).
 * - The connection state is DERIVED FRESH on every check, so revoking your last
 *   token brings the reconnect banner back even on a long-set-up account.
 */
import { prisma } from '@/lib/prisma';
import { todayInTz } from '@/lib/dates';
import { emailEnabled } from '@/lib/email';
import { targetForDate, targetAmount, TargetValues } from '@/lib/scoring';
import { toDateString } from '@/lib/dates';

export type ConnectionState = 'never_set_up' | 'connected' | 'disconnected';

export interface AccountStatus {
  steps: {
    account: boolean;
    token: boolean;
    paired: boolean;
    targets: boolean;
    weight: boolean;
  };
  setupComplete: boolean;
  connection: ConnectionState;
  skipped: boolean;
  /** Convenience for hint plumbing: which nudge applies right now, if any. */
  hint: string | null;
}

export async function getAccountStatus(userId: string): Promise<AccountStatus> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      timezone: true,
      emailVerifiedAt: true,
      firstMcpCallAt: true,
      onboardingCompletedAt: true,
      onboardingSkippedAt: true,
    },
  });
  if (!user) {
    return {
      steps: { account: false, token: false, paired: false, targets: false, weight: false },
      setupComplete: false,
      connection: 'never_set_up',
      skipped: false,
      hint: null,
    };
  }

  const [liveTokens, targetRows, weightRow] = await Promise.all([
    prisma.apiToken.count({ where: { userId, revokedAt: null } }),
    prisma.target.findMany({ where: { userId }, orderBy: { effectiveFrom: 'asc' } }),
    prisma.weight.findFirst({ where: { userId }, select: { id: true } }),
  ]);

  const today = todayInTz(user.timezone);
  const current = targetForDate(
    targetRows.map((t) => ({
      effectiveFrom: toDateString(t.effectiveFrom),
      effectiveTo: t.effectiveTo ? toDateString(t.effectiveTo) : null,
      values: t.values as TargetValues,
    })),
    today
  );
  const energy = targetAmount(current?.values['KCAL'], 'MAX').max ?? targetAmount(current?.values['KCAL'], 'MIN').min;

  const steps = {
    account: !emailEnabled() || user.emailVerifiedAt !== null,
    token: liveTokens > 0,
    paired: user.firstMcpCallAt !== null,
    targets: current !== null && energy !== undefined && energy > 0,
    weight: weightRow !== null,
  };
  const allDone = steps.account && steps.token && steps.paired && steps.targets && steps.weight;

  // Latch: stamp once, never clear. The setup flow never re-runs.
  let completedAt = user.onboardingCompletedAt;
  if (allDone && !completedAt) {
    completedAt = new Date();
    await prisma.user
      .update({ where: { id: userId }, data: { onboardingCompletedAt: completedAt } })
      .catch(() => {});
  }

  const connection: ConnectionState = !completedAt
    ? 'never_set_up'
    : liveTokens > 0
      ? 'connected'
      : 'disconnected';

  return {
    steps,
    setupComplete: completedAt !== null,
    connection,
    skipped: user.onboardingSkippedAt !== null,
    hint: !steps.targets
      ? 'No targets set yet. Ask the user for their daily energy and protein goals, then call set_targets.'
      : !steps.weight
        ? 'No weight recorded yet. Ask the user for their current weight and call log_weight.'
        : null,
  };
}
