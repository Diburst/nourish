import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/authOptions';
import { AppShell } from '@/components/AppShell';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  const user = session?.user as
    | { id: string; name: string; role: 'USER' | 'ADMIN'; mustChangePassword: boolean }
    | undefined;
  if (!user?.id) redirect('/login');
  if (user.mustChangePassword) redirect('/change-password');
  return (
    <AppShell name={user.name} isAdmin={user.role === 'ADMIN'}>
      {children}
    </AppShell>
  );
}
