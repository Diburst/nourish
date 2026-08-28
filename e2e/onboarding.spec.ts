import { test, expect, Page } from '@playwright/test';

/**
 * v1.6 E2E: fresh user → redirected to /onboarding → skip → setup banner + empty
 * states invite → create token → simulated authenticated MCP call flips pairing →
 * set targets → log weight → banner gone → log activity → Today shows an
 * unchanged baseline plus a separate "+400 from activity" → revoke the token →
 * reconnect banner appears without a redirect.
 */

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = `${process.env.ADMIN_PASSWORD ?? 'admin-password'}-changed`; // flow.spec changed it
const USER_EMAIL = `onb-${Date.now()}@example.com`;
const USER_PASSWORD = 'a-long-user-password';

test.describe.configure({ mode: 'serial' });

let inviteCode: string;
let tokenSecret: string;

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/dashboard|onboarding/);
}

test('admin creates an invite; fresh user signs up and is walled to /onboarding', async ({ page }) => {
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Create invite' }).click();
  inviteCode = (await page.getByTestId('invite-code').textContent())!.trim();

  await page.goto('/api/auth/signout');
  await page.getByRole('button', { name: 'Sign out' }).click();

  await page.goto('/signup');
  await page.getByLabel('Invite code').fill(inviteCode);
  await page.getByLabel('Name').fill('Onboarding User');
  await page.getByLabel('Email').fill(USER_EMAIL);
  await page.getByLabel('Password (10+ characters)').fill(USER_PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/onboarding/);

  // Any app route redirects back while never_set_up and not skipped.
  await page.goto('/dashboard');
  await page.waitForURL(/onboarding/);
  await expect(page.getByText('Set up in four steps')).toBeVisible();
});

test('skip → dashboard with setup banner and inviting empty states', async ({ page }) => {
  await login(page, USER_EMAIL, USER_PASSWORD);
  await page.waitForURL(/onboarding/);
  await page.getByRole('button', { name: 'Explore without an agent' }).click();
  await page.waitForURL(/dashboard/);
  await expect(page.getByTestId('setup-banner')).toBeVisible();
  await expect(page.getByText('Nothing gets logged until you finish setup')).toBeVisible();
  // Empty states name the agent prompts (shared copy).
  await expect(page.getByText('Log my breakfast', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('My weight this morning was', { exact: false }).first()).toBeVisible();
});

test('create a token on /onboarding; a real MCP call flips the pairing step', async ({ page, request }) => {
  await login(page, USER_EMAIL, USER_PASSWORD);
  await page.goto('/onboarding');
  await page.getByRole('button', { name: 'Create token' }).click();
  const secret = page.locator('code', { hasText: /^ntk_/ });
  await expect(secret).toBeVisible();
  tokenSecret = (await secret.textContent())!.trim();

  await expect(page.getByTestId('waiting-for-agent')).toBeVisible();

  // Simulate the agent: a real authenticated MCP dispatch (the pairing signal).
  const res = await request.post('/api/mcp', {
    headers: { authorization: `Bearer ${tokenSecret}`, 'content-type': 'application/json' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
  });
  expect(res.status()).toBe(200);

  // Polling flips the step green (waiting line disappears with the step collapse).
  await expect(page.getByTestId('waiting-for-agent')).toBeHidden({ timeout: 15_000 });
});

test('targets + weight via the agent complete setup; banner disappears', async ({ page, request }) => {
  const targets = await request.put('/api/targets', {
    headers: { authorization: `Bearer ${tokenSecret}` },
    data: { values: { KCAL: 2300, PROT: 160 } },
  });
  expect([200, 201]).toContain(targets.status());
  const weight = await request.post('/api/weights', {
    headers: { authorization: `Bearer ${tokenSecret}` },
    data: { value: 78.4, weightUnit: 'kg' },
  });
  expect([200, 201]).toContain(weight.status());

  await login(page, USER_EMAIL, USER_PASSWORD);
  await page.waitForURL(/dashboard/);
  await expect(page.getByTestId('setup-banner')).toBeHidden();
  await expect(page.getByTestId('reconnect-banner')).toBeHidden();

  // The completion screen celebrates and offers next prompts.
  await page.goto('/onboarding');
  await expect(page.getByText("You're set up")).toBeVisible();
  await expect(page.getByText('I ran 10 km this morning', { exact: false })).toBeVisible();
});

test('logging activity shows an unchanged baseline plus a separate adjustment', async ({ page, request }) => {
  // A meal so the day has intake, then a 400 kcal activity via the MCP tool itself.
  const meal = await request.post('/api/meals', {
    headers: { authorization: `Bearer ${tokenSecret}` },
    data: { mealType: 'LUNCH', items: [{ name: 'Bowl', quantity: 1, nutrients: { KCAL: 1850, PROT: 80 } }] },
  });
  expect(meal.status()).toBe(201);

  const mcp = await request.post('/api/mcp', {
    headers: { authorization: `Bearer ${tokenSecret}`, 'content-type': 'application/json' },
    data: {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'log_activity', arguments: { kcal: 400, proteinG: 20, label: 'Evening run' } },
    },
  });
  expect(mcp.status()).toBe(200);
  const body = (await mcp.json()) as { result: { isError?: boolean } };
  expect(body.result.isError ?? false).toBe(false);

  await login(page, USER_EMAIL, USER_PASSWORD);
  await page.waitForURL(/dashboard/);
  // Baseline number unchanged…
  await expect(page.getByText('/ 2300 kcal', { exact: false }).first()).toBeVisible();
  // …with the adjustment as a separate element, and the activity listed.
  await expect(page.getByTestId('kcal-adjustment')).toContainText('+400');
  await expect(page.getByTestId('prot-adjustment')).toContainText('+20 g');
  await expect(page.getByText('Evening run')).toBeVisible();
});

test('revoking the token brings the reconnect banner, with no redirect', async ({ page }) => {
  await login(page, USER_EMAIL, USER_PASSWORD);
  await page.goto('/settings');
  const row = page.locator('li', { hasText: 'Claude' }).first();
  await row.getByRole('button', { name: 'Revoke' }).click();
  // Wait for the revoke to land (the row strikes through) before navigating,
  // otherwise the navigation can abort the in-flight DELETE.
  await expect(row.locator('.line-through')).toBeVisible();

  await page.goto('/dashboard');
  await expect(page).toHaveURL(/dashboard/); // disconnected never redirects
  await expect(page.getByTestId('reconnect-banner')).toBeVisible();
  await expect(page.getByText('Nothing new will be logged until you create a token')).toBeVisible();
});
