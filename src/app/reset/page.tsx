'use client';

import { useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { fetchApi } from '@/lib/apiClient';

function ResetInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fetchApi('/api/password-reset/confirm', {
        method: 'POST',
        json: { token: params.get('token') ?? '', newPassword: password },
      });
      router.push('/login?reset=1');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-column flex-col items-center px-4 pt-[16vh]">
      <h1 className="mb-6 text-lg font-semibold">Choose a new password</h1>
      <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-3">
        <div>
          <label className="label" htmlFor="reset-password">New password (10+ characters)</label>
          <input id="reset-password" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} autoFocus />
        </div>
        {error && <p className="text-sm text-fail-fg">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Saving…' : 'Set password'}
        </button>
        <p className="text-xs text-muted">This signs you out everywhere else.</p>
      </form>
    </main>
  );
}

export default function ResetPage() {
  return (
    <Suspense fallback={null}>
      <ResetInner />
    </Suspense>
  );
}
