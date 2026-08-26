'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { ReactNode, useState } from 'react';

function Leaf() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M20 4C11 4 5 9 5 16c0 1.6.4 2.9 1 4 4-7 9-10 9-10s-6 5-8 12c1-.4 2.4-.7 4-1 7 0 10-7 9-17z"
        fill="#7A9B6D"
      />
    </svg>
  );
}

export function AppShell({
  name,
  isAdmin,
  theme = 'neutral',
  children,
}: {
  name: string;
  isAdmin: boolean;
  theme?: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const tabs = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/log', label: 'Log' },
    { href: '/guidelines', label: 'Guidelines' },
    ...(isAdmin ? [{ href: '/admin', label: 'Admin' }] : []),
  ];
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="min-h-screen" data-theme={theme}>
      <header className="border-b border-hairline bg-card">
        <div className="mx-auto flex max-w-column items-center gap-4 px-4 py-3">
          <Link href="/dashboard" className="flex items-center gap-1.5 font-semibold">
            <Leaf />
            <span>Nourish</span>
          </Link>
          <nav className="flex flex-1 gap-1 overflow-x-auto whitespace-nowrap text-sm">
            {tabs.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className={`rounded-md px-2.5 py-1 ${
                  pathname.startsWith(t.href) ? 'bg-wash font-medium' : 'text-muted hover:text-ink'
                }`}
              >
                {t.label}
              </Link>
            ))}
          </nav>
          <Link href="/settings" aria-label="Settings" className="text-muted hover:text-ink">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />
            </svg>
          </Link>
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-wash text-xs font-medium"
              aria-label="Account menu"
            >
              {initials || '·'}
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-9 z-40 w-40 rounded-md border border-hairline bg-card py-1 text-sm shadow-sm">
                <div className="px-3 py-1.5 text-muted">{name}</div>
                <button
                  className="block w-full px-3 py-1.5 text-left hover:bg-page"
                  onClick={() =>
                    // redirect: false + a same-origin navigation — next-auth's own
                    // redirect resolves against NEXTAUTH_URL, which hangs any browser
                    // that reached the app via a different origin (LAN IP, localhost).
                    signOut({ redirect: false }).finally(() => window.location.assign('/login'))
                  }
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-column space-y-4 px-4 py-5">{children}</main>
    </div>
  );
}
