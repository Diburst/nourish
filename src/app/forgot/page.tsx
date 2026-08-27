'use client';

import { useState } from 'react';
import Link from 'next/link';
import { fetchApi } from '@/lib/apiClient';

export default function ForgotPage() {
  const [email, setEmail] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetchApi<{ message: string }>('/api/password-reset/request', {
        method: 'POST',
        json: { email },
      });
      setResult(res.message);
    } catch (err) {
      setResult(err instanceof Error ? err.message : 'Something went wrong — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-column flex-col items-center px-4 pt-[16vh]">
      <h1 className="mb-6 text-lg font-semibold">Reset your password</h1>
      <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-3">
        {result === null ? (
          <>
            <div>
              <label className="label" htmlFor="forgot-email">Email</label>
              <input id="forgot-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </div>
            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
          </>
        ) : (
          <p className="text-sm">{result}</p>
        )}
        <p className="text-center text-xs text-muted">
          <Link className="underline" href="/login">Back to sign in</Link>
        </p>
      </form>
    </main>
  );
}
