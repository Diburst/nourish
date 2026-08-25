'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import Link from 'next/link';
import { fetchApi } from '@/lib/apiClient';

export default function SignupPage() {
  const router = useRouter();
  const [invite, setInvite] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      await fetchApi('/api/signup', {
        method: 'POST',
        json: { invite, name, email, password, timezone },
      });
      const res = await signIn('credentials', { email, password, redirect: false });
      if (res?.error) {
        router.push('/login');
        return;
      }
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-up failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-column flex-col items-center px-4 pt-[12vh]">
      <h1 className="mb-6 text-lg font-semibold">Create your account</h1>
      <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-3">
        <div>
          <label className="label" htmlFor="invite">Invite code</label>
          <input id="invite" className="input" value={invite} onChange={(e) => setInvite(e.target.value)} required autoFocus />
        </div>
        <div>
          <label className="label" htmlFor="name">Name</label>
          <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="password">Password (10+ characters)</label>
          <input id="password" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} />
        </div>
        {error && <p className="text-sm text-fail-fg">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
        <p className="text-center text-xs text-muted">
          Already set up? <Link className="underline" href="/login">Sign in</Link>
        </p>
      </form>
    </main>
  );
}
