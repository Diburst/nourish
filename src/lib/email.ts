/**
 * Account email via the Resend REST API — a plain fetch client, no SDK, so the wiring
 * is testable against a local fake (RESEND_BASE_URL) and adds nothing to the
 * standalone dependency closure. When RESEND_API_KEY is absent the app runs exactly
 * as before: emails log to the console and every email-gated feature stays optional.
 */
import { logger } from '@/lib/logger';

export function emailEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export interface EmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailResult {
  delivered: boolean;
  id?: string;
  error?: string;
}

export async function sendEmail(input: EmailInput): Promise<EmailResult> {
  if (!emailEnabled()) {
    logger.info('Email (console fallback — RESEND_API_KEY not configured)', {
      to: input.to,
      subject: input.subject,
      text: input.text,
    });
    return { delivered: false };
  }
  const base = (process.env.RESEND_BASE_URL ?? 'https://api.resend.com').replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/emails`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      logger.error('Email send failed', { operation: 'sendEmail', status: res.status, detail: detail.slice(0, 300) });
      return { delivered: false, error: `Resend returned ${res.status}` };
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string };
    logger.info('Email sent', { to: input.to, subject: input.subject, id: body.id });
    return { delivered: true, id: body.id };
  } catch (error) {
    logger.error('Email send failed', {
      operation: 'sendEmail',
      error: error instanceof Error ? error.message : 'unknown',
    });
    return { delivered: false, error: 'network' };
  }
}

/** One shared, minimal template — matches the app's off-white voice. */
export function emailLayout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#fafaf8;padding:32px 16px;font-family:-apple-system,'Segoe UI',sans-serif;color:#1c1c1a;">
  <div style="max-width:460px;margin:0 auto;background:#ffffff;border:1px solid #e7e5e1;border-radius:8px;padding:28px;">
    <p style="margin:0 0 14px;font-size:15px;font-weight:600;"><span style="color:#7a9b6d;">☘</span> Nourish</p>
    <p style="margin:0 0 10px;font-size:16px;font-weight:600;">${title}</p>
    ${bodyHtml}
    <p style="margin:18px 0 0;font-size:12px;color:#8a8880;">If you weren't expecting this email, you can ignore it — nothing changes without the link above.</p>
  </div></body></html>`;
}

export function emailButton(url: string, label: string): string {
  return `<p style="margin:16px 0;"><a href="${url}" style="background:#1c1c1a;color:#ffffff;text-decoration:none;border-radius:6px;padding:10px 16px;font-size:14px;display:inline-block;">${label}</a></p>
  <p style="margin:0;font-size:12px;color:#8a8880;word-break:break-all;">Or paste this link: ${url}</p>`;
}

/** Public app origin for links in emails (and the origin the OAuth metadata uses). */
export function appOrigin(): string {
  const mcp = process.env.MCP_PUBLIC_URL;
  if (mcp) {
    try {
      return new URL(mcp).origin;
    } catch {
      /* fall through */
    }
  }
  return process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
}
