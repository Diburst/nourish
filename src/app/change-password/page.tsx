'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchApi } from '@/lib/apiClient';

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fetchApi('/api/me/password', { method: 'POST', json: { currentPassword, newPassword } });
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-column flex-col items-center px-4 pt-[16vh]">
      <h1 className="mb-2 text-lg font-semibold">Change your password</h1>
      <p className="mb-5 text-sm text-muted">You must set a new password before continuing.</p>
      <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-3">
        <div>
          <label className="label" htmlFor="current">Current (temporary) password</label>
          <input id="current" type="password" className="input" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required autoFocus />
        </div>
        <div>
          <label className="label" htmlFor="new">New password (10+ characters)</label>
          <input id="new" type="password" className="input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={10} />
        </div>
        {error && <p className="text-sm text-fail-fg">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </main>
  );
}
