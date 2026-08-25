import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { checkLoginBackoff, recordLoginFailure, clearLoginFailures } from '@/lib/loginBackoff';

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: '/login' },
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, req) {
        const email = credentials?.email?.toLowerCase().trim();
        const password = credentials?.password;
        if (!email || !password) return null;
        const ip =
          (req?.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() || 'unknown';

        if (checkLoginBackoff(email)) {
          await prisma.authEvent
            .create({ data: { type: 'LOGIN_LOCKED', ip } })
            .catch(() => {});
          throw new Error('Too many failed attempts. Try again in 15 minutes.');
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || user.disabledAt) {
          recordLoginFailure(email);
          await prisma.authEvent
            .create({ data: { userId: user?.id, type: 'LOGIN_FAILED', ip } })
            .catch(() => {});
          return null;
        }
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) {
          const locked = recordLoginFailure(email);
          await prisma.authEvent
            .create({ data: { userId: user.id, type: locked ? 'LOGIN_LOCKOUT' : 'LOGIN_FAILED', ip } })
            .catch(() => {});
          return null;
        }
        clearLoginFailures(email);
        await prisma.authEvent.create({ data: { userId: user.id, type: 'LOGIN', ip } }).catch(() => {});
        logger.info('Login', { userId: user.id });
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: { sessionVersion: true },
        });
        token.sv = dbUser?.sessionVersion ?? 0;
      }
      // Re-check the user each request: disabled users and forced logouts take effect immediately.
      if (token.userId) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.userId as string },
          select: {
            id: true,
            role: true,
            mustChangePassword: true,
            disabledAt: true,
            name: true,
            email: true,
            sessionVersion: true,
          },
        });
        if (!dbUser || dbUser.disabledAt || dbUser.sessionVersion !== (token.sv ?? 0)) {
          token.invalid = true;
        } else {
          token.invalid = false;
          token.role = dbUser.role;
          token.mustChangePassword = dbUser.mustChangePassword;
          token.name = dbUser.name;
          token.email = dbUser.email;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token.invalid) {
        // Downstream requireAuth treats a session without user id as unauthenticated.
        return { ...session, user: undefined } as never;
      }
      return {
        ...session,
        user: {
          id: token.userId as string,
          email: token.email as string,
          name: token.name as string,
          role: token.role as 'USER' | 'ADMIN',
          mustChangePassword: token.mustChangePassword as boolean,
        },
      };
    },
  },
};
