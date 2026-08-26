import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/authOptions';
import { prisma } from '@/lib/prisma';
import { AppShell } from '@/components/AppShell';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  const user = session?.user as
    | { id: string; name: string; role: 'USER' | 'ADMIN'; mustChangePassword: boolean }
    | undefined;
  if (!user?.id) redirect('/login');
  if (user.mustChangePassword) redirect('/change-password');
  const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { theme: true } });
  return (
    <AppShell name={user.name} isAdmin={user.role === 'ADMIN'} theme={dbUser?.theme ?? 'neutral'}>
      {children}
    </AppShell>
  );
}
