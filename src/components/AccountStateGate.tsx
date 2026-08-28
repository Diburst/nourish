'use client';

/**
 * The soft wall and both banners, rendered from the same status the redirect uses.
 *
 * | state                     | behaviour                                        |
 * | connected                 | normal app, no banner                            |
 * | never_set_up, not skipped | any app route redirects to /onboarding           |
 * | never_set_up, skipped     | full app access, setup banner on every page      |
 * | disconnected              | full app access, reconnect banner, NO redirect   |
 *
 * Admins are exempt: they cannot hold agent tokens, so none of this applies.
 * There is no API-level gate anywhere — the MCP endpoint must keep working in
 * every state, because the agent is what satisfies the gate.
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAccountStatus } from '@/hooks/useApi';
import type { ApiAccountStatus } from '@/types/api';
import { InfoDot } from '@/components/Help';

/** Routes a never-set-up user may still visit. /api/* and sign-out never render this shell. */
const REDIRECT_ALLOWLIST = ['/onboarding', '/settings', '/help', '/admin'];

export function AccountStateGate({
  isAdmin,
  initialStatus,
}: {
  isAdmin: boolean;
  initialStatus?: ApiAccountStatus;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: status } = useAccountStatus({ initialData: initialStatus });

  const mustRedirect =
    !isAdmin &&
    status?.connection === 'never_set_up' &&
    !status.skipped &&
    !REDIRECT_ALLOWLIST.some((p) => pathname.startsWith(p));

  useEffect(() => {
    if (mustRedirect) router.replace('/onboarding');
  }, [mustRedirect, router]);

  if (isAdmin || !status || mustRedirect) return null;
  if (status.connection === 'connected') return null;
  if (pathname.startsWith('/onboarding')) return null;

  if (status.connection === 'never_set_up') {
    // skipped === true here (otherwise we redirected)
    return (
      <Banner testid="setup-banner">
        <span>Nourish needs a paired agent. Nothing gets logged until you finish setup.</span>
        <Link href="/onboarding" className="shrink-0 font-medium underline">
          Finish setup
        </Link>
      </Banner>
    );
  }

  // disconnected: they know the app — a nudge and a link, not a wizard.
  return (
    <Banner testid="reconnect-banner">
      <span>
        No agent is connected. Nothing new will be logged until you create a token and pair one.{' '}
        <InfoDot topic="revoking-last-token" />
      </span>
      <Link href="/settings#tokens" className="shrink-0 font-medium underline">
        Create a token
      </Link>
    </Banner>
  );
}

function Banner({ children, testid }: { children: React.ReactNode; testid: string }) {
  return (
    <div className="border-b border-hairline bg-wip-bg text-wip-fg" data-testid={testid}>
      <div className="mx-auto flex max-w-column items-center justify-between gap-3 px-4 py-2 text-sm">
        {children}
      </div>
    </div>
  );
}
