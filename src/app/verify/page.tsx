'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { fetchApi } from '@/lib/apiClient';

function VerifyInner() {
  const params = useSearchParams();
  const [state, setState] = useState<'working' | 'ok' | 'changed' | 'error'>('working');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const token = params.get('token');
    const kind = params.get('kind') === 'change' ? 'change' : 'verify';
    if (!token) {
      setState('error');
      setMessage('This link is missing its token.');
      return;
    }
    fetchApi<{ action: string; email?: string }>('/api/verify-email', {
      method: 'POST',
      json: { token, kind },
    })
      .then((res) => {
        setState(res.action === 'changed' ? 'changed' : 'ok');
        if (res.email) setMessage(res.email);
      })
      .catch((err) => {
        setState('error');
        setMessage(err instanceof Error ? err.message : 'Verification failed');
      });
  }, [params]);

  return (
    <main className="mx-auto flex max-w-column flex-col items-center px-4 pt-[18vh]">
      <div className="card w-full max-w-sm text-center">
        {state === 'working' && <p className="text-sm text-muted">Verifying…</p>}
        {state === 'ok' && (
          <>
            <p className="mb-1 text-2xl">✓</p>
            <p className="text-sm font-medium">Email verified</p>
            <p className="mt-1 text-sm text-muted">Your account is active.</p>
          </>
        )}
        {state === 'changed' && (
          <>
            <p className="mb-1 text-2xl">✓</p>
            <p className="text-sm font-medium">Email updated</p>
            <p className="mt-1 text-sm text-muted">Sign in with {message || 'your new address'} from now on.</p>
          </>
        )}
        {state === 'error' && (
          <>
            <p className="text-sm font-medium text-fail-fg">Verification failed</p>
            <p className="mt-1 text-sm text-muted">{message}</p>
          </>
        )}
        {state !== 'working' && (
          <Link href="/login" className="btn-primary mt-4 inline-block px-5">
            Go to sign in
          </Link>
        )}
      </div>
    </main>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={null}>
      <VerifyInner />
    </Suspense>
  );
}
