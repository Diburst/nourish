'use client';

import { ReactNode, useEffect } from 'react';

export function Card({ title, action, children }: { title?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export type TileState = 'ok' | 'fail' | 'wip' | 'none';

export function StatusTile({ state, className = '' }: { state: TileState; className?: string }) {
  const glyph = state === 'ok' ? '✓' : state === 'fail' ? '✕' : state === 'wip' ? '⏱' : '—';
  return <div className={`tile tile-${state} ${className}`}>{glyph}</div>;
}

/**
 * Progress row anatomy (spec §7): two-column grid — left: label + value line over an
 * 8px bar; right: a status tile exactly as tall as that block.
 */
export function ProgressRow({
  label,
  value,
  fraction,
  state,
}: {
  label: string;
  value: string;
  fraction: number; // 0..1, clamped
  state: TileState;
}) {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <div className="grid grid-cols-[1fr_44px] items-stretch gap-3">
      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-sm">{label}</span>
          <span className="text-sm tabular-nums text-muted">{value}</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-bar">
          <div className="h-full rounded-full bg-barfill" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <StatusTile state={state} />
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/20 p-4 pt-[10vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="card w-full max-w-sm shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button className="text-muted hover:text-ink" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-3 text-center text-sm text-muted">{children}</p>;
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : 'Something went wrong';
  return <p className="mt-2 text-sm text-fail-fg">{message}</p>;
}
