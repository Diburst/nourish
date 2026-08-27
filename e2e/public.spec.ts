import { test, expect } from '@playwright/test';

test('landing page greets logged-out visitors with sign-in paths', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your agents do the logging');
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'I have an invite' })).toBeVisible();
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.waitForURL(/\/login/);
});

test('security headers are served on every page', async ({ page }) => {
  const response = await page.goto('/');
  const headers = response!.headers();
  expect(headers['content-security-policy']).toContain("default-src 'self'");
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['strict-transport-security']).toContain('max-age=');
});

test('forgot-password page degrades gracefully without an email service', async ({ page }) => {
  await page.goto('/forgot');
  await page.getByLabel('Email').fill('whoever@example.com');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  // The e2e server has no RESEND_API_KEY: the page explains the admin path instead.
  await expect(page.getByText(/ask your admin/i)).toBeVisible();
});
