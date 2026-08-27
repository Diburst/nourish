/**
 * Account email flows: verification, password reset, email change, invites, and
 * security notices. All optional — with no RESEND_API_KEY the senders log to the
 * console and account behavior stays as it was (invite-pinned identity, admin
 * temp-password resets).
 */
import { randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';
import { hashToken } from '@/lib/apiAuth';
import { sendEmail, emailLayout, emailButton, appOrigin, EmailResult } from '@/lib/email';

export type EmailTokenKind = 'VERIFY' | 'RESET' | 'EMAIL_CHANGE';

const TTL_MS: Record<EmailTokenKind, number> = {
  VERIFY: 7 * 24 * 60 * 60 * 1000,
  RESET: 30 * 60 * 1000,
  EMAIL_CHANGE: 60 * 60 * 1000,
};

/** Mint a single-use token (hash stored) and return the raw value for the link. */
export async function issueEmailToken(
  userId: string,
  kind: EmailTokenKind,
  newEmail?: string
): Promise<string> {
  const raw = randomBytes(32).toString('base64url');
  await prisma.emailToken.create({
    data: {
      userId,
      tokenHash: hashToken(raw),
      kind,
      newEmail: newEmail ?? null,
      expiresAt: new Date(Date.now() + TTL_MS[kind]),
    },
  });
  // Opportunistic cleanup.
  prisma.emailToken.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});
  return raw;
}

/** Look up a live token; returns null when missing/used/expired. Does not consume. */
export async function findEmailToken(raw: string, kind: EmailTokenKind) {
  const token = await prisma.emailToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: { user: { select: { id: true, email: true, disabledAt: true } } },
  });
  if (!token || token.kind !== kind || token.usedAt || token.expiresAt < new Date()) return null;
  if (token.user.disabledAt) return null;
  return token;
}

export async function sendVerificationEmail(user: { id: string; email: string; name: string }): Promise<EmailResult> {
  const raw = await issueEmailToken(user.id, 'VERIFY');
  const url = `${appOrigin()}/verify?token=${raw}`;
  return sendEmail({
    to: user.email,
    subject: 'Verify your Nourish email',
    html: emailLayout(
      `Welcome, ${user.name}`,
      `<p style="margin:0;font-size:14px;">Confirm this address to activate your account.</p>${emailButton(url, 'Verify email')}`
    ),
    text: `Welcome to Nourish. Verify your email: ${url}`,
  });
}

export async function sendPasswordResetEmail(user: { id: string; email: string; name: string }): Promise<EmailResult> {
  const raw = await issueEmailToken(user.id, 'RESET');
  const url = `${appOrigin()}/reset?token=${raw}`;
  return sendEmail({
    to: user.email,
    subject: 'Reset your Nourish password',
    html: emailLayout(
      'Reset your password',
      `<p style="margin:0;font-size:14px;">This link works once and expires in 30 minutes.</p>${emailButton(url, 'Choose a new password')}`
    ),
    text: `Reset your Nourish password (expires in 30 minutes): ${url}`,
  });
}

export async function sendEmailChangeEmail(
  user: { id: string; name: string },
  newEmail: string
): Promise<EmailResult> {
  const raw = await issueEmailToken(user.id, 'EMAIL_CHANGE', newEmail);
  const url = `${appOrigin()}/verify?token=${raw}&kind=change`;
  return sendEmail({
    to: newEmail,
    subject: 'Confirm your new Nourish email',
    html: emailLayout(
      'Confirm your new email',
      `<p style="margin:0;font-size:14px;">Click to move your Nourish account to this address.</p>${emailButton(url, 'Confirm new email')}`
    ),
    text: `Confirm your new Nourish email address: ${url}`,
  });
}

export async function sendInviteEmail(email: string, code: string): Promise<EmailResult> {
  const url = `${appOrigin()}/signup`;
  return sendEmail({
    to: email,
    subject: "You're invited to Nourish",
    html: emailLayout(
      "You're invited",
      `<p style="margin:0 0 8px;font-size:14px;">Create your account at <a href="${url}">${url}</a> with this invite code (valid 7 days):</p>
       <p style="margin:0;font-family:ui-monospace,monospace;font-size:13px;background:#f1f0ed;border-radius:6px;padding:10px;word-break:break-all;">${code}</p>`
    ),
    text: `You're invited to Nourish. Sign up at ${url} with invite code: ${code}`,
  });
}

/** Security notices — fire-and-forget; silent no-ops when email is unconfigured. */
export function sendSecurityNotice(email: string, title: string, detail: string): void {
  sendEmail({
    to: email,
    subject: `Nourish security: ${title}`,
    html: emailLayout(title, `<p style="margin:0;font-size:14px;">${detail} If this was you, no action is needed. If not, revoke tokens and change your password in Settings.</p>`),
    text: `${title}. ${detail} If this wasn't you, revoke tokens and change your password in Settings.`,
  }).catch(() => {});
}
