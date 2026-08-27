'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, EmptyState, ErrorText, Modal } from '@/components/ui';
import { fetchApi, queryKeys } from '@/lib/apiClient';
import { useApiMutation, useMe } from '@/hooks/useApi';
import { formatRelative } from '@/lib/format';

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  timezone: string;
  mustChangePassword: boolean;
  disabledAt: string | null;
  createdAt: string;
  tokenCount: number;
}

export default function AdminPage() {
  const { data: me } = useMe();
  if (me && me.role !== 'ADMIN') {
    return <p className="py-8 text-center text-sm text-muted">Not found</p>;
  }
  return (
    <>
      <h1 className="text-base font-semibold">Admin</h1>
      <UsersCard />
      <InvitesCard />
      <TokensOverviewCard />
      <AuthEventsCard />
      <OpsCard />
    </>
  );
}

function AuthEventsCard() {
  const { data } = useQuery({
    queryKey: ['admin', 'auth-events'],
    queryFn: () =>
      fetchApi<{ events: { id: string; type: string; ip: string; userEmail: string | null; meta: Record<string, unknown> | null; createdAt: string }[] }>(
        '/api/admin/auth-events'
      ),
    refetchInterval: 60_000,
  });
  return (
    <Card title="Auth log">
      {(data?.events ?? []).length === 0 ? (
        <EmptyState>No auth events yet</EmptyState>
      ) : (
        <ul className="max-h-64 space-y-0.5 overflow-y-auto text-xs">
          {data!.events.map((e) => (
            <li key={e.id} className="flex items-baseline justify-between gap-2 border-t border-hairline py-1 first:border-t-0">
              <span>
                <span className="font-medium">{e.type.toLowerCase().replace(/_/g, ' ')}</span>
                {e.userEmail && <span className="text-muted"> · {e.userEmail}</span>}
                {e.meta && Object.keys(e.meta).length > 0 && (
                  <span className="text-muted"> · {Object.entries(e.meta).map(([k, v]) => `${k}: ${String(v)}`).join(', ')}</span>
                )}
              </span>
              <span className="whitespace-nowrap text-muted">
                {e.ip} · {formatRelative(e.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function UsersCard() {
  const { data, refetch } = useQuery({
    queryKey: queryKeys.admin.users,
    queryFn: () => fetchApi<{ users: AdminUser[] }>('/api/admin/users'),
  });
  const [tempFor, setTempFor] = useState<AdminUser | null>(null);
  const patch = useApiMutation(
    ({ id, json }: { id: string; json: Record<string, unknown> }) =>
      fetchApi(`/api/admin/users/${id}`, { method: 'PATCH', json }),
    [['admin', 'users']]
  );
  return (
    <Card title="Users">
      <ul className="divide-y divide-hairline text-sm">
        {(data?.users ?? []).map((u) => (
          <li key={u.id} className="flex items-center justify-between gap-2 py-2">
            <span>
              <span className={u.disabledAt ? 'text-muted line-through' : 'font-medium'}>{u.name}</span>{' '}
              <span className="text-xs text-muted">
                {u.email} · {u.role.toLowerCase()} · {u.tokenCount} token{u.tokenCount === 1 ? '' : 's'}
                {u.mustChangePassword && ' · must change password'}
              </span>
            </span>
            <span className="flex shrink-0 gap-2 text-xs">
              <button className="text-muted underline hover:text-ink" onClick={() => setTempFor(u)}>
                temp password
              </button>
              <button
                className="text-muted underline hover:text-ink"
                onClick={() => patch.mutate({ id: u.id, json: { forceLogout: true } }, { onSuccess: () => refetch() })}
              >
                force logout
              </button>
              <button
                className="text-muted underline hover:text-ink"
                onClick={() => patch.mutate({ id: u.id, json: { disabled: !u.disabledAt } })}
              >
                {u.disabledAt ? 'enable' : 'disable'}
              </button>
            </span>
          </li>
        ))}
      </ul>
      <ErrorText error={patch.error} />
      {tempFor && <TempPasswordModal user={tempFor} onClose={() => setTempFor(null)} />}
    </Card>
  );
}

function TempPasswordModal({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const patch = useApiMutation(
    () => fetchApi(`/api/admin/users/${user.id}`, { method: 'PATCH', json: { tempPassword: password } }),
    [['admin', 'users']]
  );
  return (
    <Modal open onClose={onClose} title={`Temporary password for ${user.email}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          patch.mutate(undefined as never, { onSuccess: onClose });
        }}
        className="space-y-3"
      >
        <input
          className="input"
          type="text"
          placeholder="Temporary password (10+ chars)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={10}
          required
          aria-label="Temporary password"
        />
        <p className="text-xs text-muted">They must change it at next login.</p>
        <ErrorText error={patch.error} />
        <button type="submit" className="btn-primary w-full" disabled={patch.isPending}>
          Set temporary password
        </button>
      </form>
    </Modal>
  );
}

function InvitesCard() {
  const { data } = useQuery({
    queryKey: queryKeys.admin.invites,
    queryFn: () =>
      fetchApi<{ invites: { id: string; email: string | null; expiresAt: string; usedAt: string | null; usedByEmail: string | null; expired: boolean }[] }>(
        '/api/admin/invites'
      ),
  });
  const [email, setEmail] = useState('');
  const [sendByEmail, setSendByEmail] = useState(false);
  const [created, setCreated] = useState<{ code: string; emailed?: boolean } | null>(null);
  const create = useApiMutation(
    () =>
      fetchApi<{ code: string; emailed: boolean }>('/api/admin/invites', {
        method: 'POST',
        json: email ? { email, send: sendByEmail } : {},
      }),
    [['admin', 'invites']]
  );
  const revoke = useApiMutation((id: string) => fetchApi(`/api/admin/invites/${id}`, { method: 'DELETE' }), [
    ['admin', 'invites'],
  ]);
  return (
    <Card title="Invites">
      {(data?.invites ?? []).length === 0 ? (
        <EmptyState>No invites yet</EmptyState>
      ) : (
        <ul className="divide-y divide-hairline text-sm">
          {data!.invites.map((i) => (
            <li key={i.id} className="flex items-center justify-between py-1.5">
              <span className="text-muted">
                {i.email ?? 'anyone'} ·{' '}
                {i.usedAt ? `used by ${i.usedByEmail}` : i.expired ? 'expired' : `expires ${formatRelative(i.expiresAt).replace(' ago', '')}`}
              </span>
              {!i.usedAt && (
                <button className="text-xs text-muted underline hover:text-ink" onClick={() => revoke.mutate(i.id)}>
                  revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(undefined as never, {
            onSuccess: (res) => {
              setCreated(res);
              setEmail('');
            },
          });
        }}
      >
        <input className="input flex-1" type="email" placeholder="Pin to email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button type="submit" className="btn" disabled={create.isPending}>
          Create invite
        </button>
      </form>
      {email && (
        <label className="mt-2 flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={sendByEmail} onChange={(e) => setSendByEmail(e.target.checked)} />
          Email the invite code to them (needs the email service configured)
        </label>
      )}
      <ErrorText error={create.error || revoke.error} />
      {created && (
        <Modal open onClose={() => setCreated(null)} title="Invite code">
          <p className="mb-2 text-sm">
            {created.emailed
              ? 'Invite emailed. The code below is your copy — it expires in 7 days.'
              : 'Share this code — it is shown once and expires in 7 days.'}
          </p>
          <code className="block break-all rounded bg-page p-2 text-xs" data-testid="invite-code">{created.code}</code>
          <button className="btn-primary mt-3 w-full" onClick={() => setCreated(null)}>
            Done
          </button>
        </Modal>
      )}
    </Card>
  );
}

function TokensOverviewCard() {
  const { data } = useQuery({
    queryKey: queryKeys.admin.tokens,
    queryFn: () =>
      fetchApi<{ tokens: { id: string; name: string; userEmail: string; scopes: string[]; lastUsedAt: string | null; revokedAt: string | null }[] }>(
        '/api/admin/tokens'
      ),
  });
  const revoke = useApiMutation((id: string) => fetchApi(`/api/admin/tokens/${id}`, { method: 'DELETE' }), [
    ['admin', 'tokens'],
  ]);
  const dropGw = useApiMutation(
    (id: string) => fetchApi(`/api/admin/tokens/${id}`, { method: 'PATCH', json: { removeGuidelinesWrite: true } }),
    [['admin', 'tokens']]
  );
  return (
    <Card title="Tokens">
      {(data?.tokens ?? []).length === 0 ? (
        <EmptyState>No tokens yet</EmptyState>
      ) : (
        <ul className="divide-y divide-hairline text-sm">
          {data!.tokens.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 py-1.5">
              <span className={t.revokedAt ? 'text-muted line-through' : ''}>
                {t.name}
                <span className="ml-1 text-xs text-muted">
                  {t.userEmail} · {t.scopes.join(', ')} · {t.lastUsedAt ? `used ${formatRelative(t.lastUsedAt)}` : 'never used'}
                </span>
              </span>
              {!t.revokedAt && (
                <span className="flex shrink-0 gap-2 text-xs">
                  {t.scopes.includes('guidelines:write') && (
                    <button className="text-muted underline hover:text-ink" onClick={() => dropGw.mutate(t.id)}>
                      drop guidelines:write
                    </button>
                  )}
                  <button className="text-muted underline hover:text-ink" onClick={() => revoke.mutate(t.id)}>
                    revoke
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <ErrorText error={revoke.error || dropGw.error} />
    </Card>
  );
}

function OpsCard() {
  const { data: health } = useQuery({
    queryKey: queryKeys.admin.health,
    queryFn: () =>
      fetchApi<{ status: string; dbLatencyMs: number; counts: { users: number; activeTokens: number; openInvites: number }; uptimeSeconds: number }>(
        '/api/admin/health'
      ),
    refetchInterval: 30_000,
  });
  const { data: settings } = useQuery({
    queryKey: queryKeys.admin.settings,
    queryFn: () => fetchApi<{ rateLimits: Record<string, string>; rateLimitBackend: string }>('/api/admin/settings'),
  });
  const { data: backups, refetch } = useQuery({
    queryKey: queryKeys.admin.backups,
    queryFn: () =>
      fetchApi<{ mode?: string; note?: string; backups: { file: string; bytes: number; createdAt: string }[]; lastStatus: { at: string; ok: boolean; file?: string; error?: string } | null }>(
        '/api/admin/backups'
      ),
  });
  const managed = backups?.mode === 'managed';
  const backupNow = useApiMutation(() => fetchApi('/api/admin/backups', { method: 'POST' }), [['admin', 'backups']]);

  return (
    <Card title="Health, rate limits & backups">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <span className="text-muted">Status</span>
        <span>{health ? `${health.status} · db ${health.dbLatencyMs}ms · up ${Math.floor(health.uptimeSeconds / 3600)}h` : '—'}</span>
        <span className="text-muted">Accounts</span>
        <span>{health ? `${health.counts.users} users · ${health.counts.activeTokens} tokens · ${health.counts.openInvites} open invites` : '—'}</span>
        <span className="text-muted">Rate limiting</span>
        <span>{settings ? `${settings.rateLimitBackend}` : '—'}</span>
        {settings &&
          Object.entries(settings.rateLimits).map(([k, v]) => (
            <span key={k} className="contents">
              <span className="pl-3 text-muted">{k}</span>
              <span>{v}</span>
            </span>
          ))}
      </div>
      <div className="mt-3 border-t border-hairline pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">Backups</span>
          {!managed && (
            <button
              className="btn"
              disabled={backupNow.isPending}
              onClick={() => backupNow.mutate(undefined as never, { onSuccess: () => refetch() })}
            >
              {backupNow.isPending ? 'Running…' : 'Backup now'}
            </button>
          )}
        </div>
        {managed && <p className="mb-1 text-xs text-muted">{backups?.note}</p>}
        {backups?.lastStatus && (
          <p className="mb-1 text-xs text-muted">
            Last: {backups.lastStatus.ok ? `ok (${backups.lastStatus.file})` : `failed — ${backups.lastStatus.error}`} ·{' '}
            {formatRelative(backups.lastStatus.at)}
          </p>
        )}
        <ul className="max-h-32 space-y-0.5 overflow-y-auto text-xs text-muted">
          {(backups?.backups ?? []).map((b) => (
            <li key={b.file}>
              {b.file} · {(b.bytes / 1024).toFixed(0)} KB
            </li>
          ))}
        </ul>
        <ErrorText error={backupNow.error} />
      </div>
    </Card>
  );
}
