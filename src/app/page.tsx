import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';

function Leaf() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M20 4C11 4 5 9 5 16c0 1.6.4 2.9 1 4 4-7 9-10 9-10s-6 5-8 12c1-.4 2.4-.7 4-1 7 0 10-7 9-17z"
        fill="#7A9B6D"
      />
    </svg>
  );
}

/** Logged-out landing page; signed-in users go straight to the dashboard. */
export default async function Home() {
  const session = await getServerSession(authOptions);
  if ((session?.user as { id?: string } | undefined)?.id) redirect('/dashboard');

  return (
    <main className="mx-auto flex min-h-screen max-w-column flex-col px-6">
      <header className="flex items-center gap-2 py-6 font-semibold">
        <Leaf />
        <span>Nourish</span>
      </header>
      <div className="flex flex-1 flex-col justify-center pb-24">
        <h1 className="text-3xl font-semibold leading-tight tracking-tight">
          Your agents do the logging.
          <br />
          You just eat.
        </h1>
        <p className="mt-4 max-w-md text-muted">
          Nourish is a quiet nutrition tracker built for the agent era: tell Claude what you ate,
          and the dashboard answers the only question that matters — how am I doing?
        </p>
        <ul className="mt-6 max-w-md space-y-2 text-sm text-muted">
          <li>· Meals, targets and weight kept by your AI assistant over MCP</li>
          <li>· Day checkmarks and streaks that never rewrite history</li>
          <li>· Every agent edit audited, pinnable, and revocable</li>
        </ul>
        <div className="mt-8 flex gap-3">
          <Link href="/login" className="btn-primary px-5 py-2">
            Sign in
          </Link>
          <Link href="/signup" className="btn px-5 py-2">
            I have an invite
          </Link>
        </div>
        <p className="mt-6 text-xs text-muted">Invite-only. Your data stays yours — export it any time.</p>
      </div>
    </main>
  );
}
