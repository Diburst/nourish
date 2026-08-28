import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/authOptions';
import { prisma } from '@/lib/prisma';
import { AppShell } from '@/components/AppShell';
import { getAccountStatus } from '@/lib/onboarding';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  const user = session?.user as
    | { id: string; name: string; role: 'USER' | 'ADMIN'; mustChangePassword: boolean }
    | undefined;
  if (!user?.id) redirect('/login');
  if (user.mustChangePassword) redirect('/change-password');
  const isAdmin = user.role === 'ADMIN';
  const [dbUser, status] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { theme: true } }),
    // The soft wall reads the same status function as the banners and the wizard.
    // Admins are exempt (they cannot hold agent tokens).
    isAdmin ? Promise.resolve(null) : getAccountStatus(user.id),
  ]);
  return (
    <AppShell
      name={user.name}
      isAdmin={isAdmin}
      theme={dbUser?.theme ?? 'neutral'}
      initialStatus={
        status
          ? {
              steps: status.steps,
              setupComplete: status.setupComplete,
              connection: status.connection,
              skipped: status.skipped,
              mcpPublicUrl: process.env.MCP_PUBLIC_URL || null,
            }
          : undefined
      }
    >
      {children}
    </AppShell>
  );
}
