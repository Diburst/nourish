import { test, expect, Page, APIRequestContext } from '@playwright/test';

/**
 * The §9 end-to-end flow, in order:
 * invite → sign-up → create token → POST lunch via API → dashboard shows it →
 * edit item in UI (pins) → agent PATCH gets 409 → override succeeds →
 * Log shows the chain → change target → yesterday's checkmark unchanged.
 */

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'admin-password';
const USER_EMAIL = `user-${Date.now()}@example.com`;
const USER_PASSWORD = 'a-long-user-password';

function todayStr(offset = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Settle on whichever screen the server lands us on (dashboard, or the forced
  // password change) — the client-side push can pass through /dashboard first.
  await page
    .getByRole('heading', { name: 'Change your password' })
    .or(page.getByText('Today', { exact: false }).first())
    .first()
    .waitFor();
}

test.describe.configure({ mode: 'serial' });

let inviteCode: string;
let tokenSecret: string;
let mealId: string;
let itemId: string;

test('admin signs in (forced password change) and creates an invite', async ({ page }) => {
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  if (page.url().includes('change-password')) {
    await page.getByLabel('Current (temporary) password').fill(ADMIN_PASSWORD);
    await page.getByLabel('New password (10+ characters)').fill(`${ADMIN_PASSWORD}-changed`);
    await page.getByRole('button', { name: 'Save password' }).click();
    await page.waitForURL(/dashboard/);
  }
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Create invite' }).click();
  const code = page.getByTestId('invite-code');
  await expect(code).toBeVisible();
  inviteCode = (await code.textContent())!.trim();
  expect(inviteCode.length).toBeGreaterThan(10);
});

test('sign-up via invite lands on onboarding (soft wall); skipping reaches the dashboard', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Invite code').fill(inviteCode);
  await page.getByLabel('Name').fill('E2E User');
  await page.getByLabel('Email').fill(USER_EMAIL);
  await page.getByLabel('Password (10+ characters)').fill(USER_PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/onboarding/);
  await expect(page.getByText('Nourish has no food diary')).toBeVisible();
  await page.getByRole('button', { name: 'Explore without an agent' }).click();
  await page.waitForURL(/dashboard/);
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(page.getByTestId('setup-banner')).toBeVisible();
});

test('create an agent token in Settings', async ({ page }) => {
  await login(page, USER_EMAIL, USER_PASSWORD);
  await page.goto('/settings');
  await page.getByPlaceholder('Token name (e.g. "Claude desktop")').fill('Claude desktop');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const secret = page.getByTestId('token-secret');
  await expect(secret).toBeVisible();
  tokenSecret = (await secret.textContent())!.trim();
  expect(tokenSecret).toMatch(/^ntk_/);
});

test('agent POSTs lunch (and yesterday\'s dinner + targets) via the API', async ({ request }) => {
  const targets = await request.put('/api/targets', {
    headers: { authorization: `Bearer ${tokenSecret}` },
    data: { effectiveFrom: todayStr(-7), values: { KCAL: 2000, PROT: 40 } },
  });
  expect(targets.status()).toBe(201);

  const yesterday = await request.post('/api/meals', {
    headers: { authorization: `Bearer ${tokenSecret}` },
    data: {
      date: todayStr(-1),
      mealType: 'DINNER',
      items: [{ name: 'Salmon and rice', quantity: 1, nutrients: { KCAL: 900, PROT: 45 } }],
    },
  });
  expect(yesterday.status()).toBe(201);

  const lunch = await request.post('/api/meals', {
    headers: { authorization: `Bearer ${tokenSecret}` },
    data: {
      date: todayStr(),
      mealType: 'LUNCH',
      items: [
        {
          idempotencyKey: `${todayStr()}-lunch-bowl`,
          name: 'Chicken burrito bowl',
          quantity: 1,
          nutrients: { KCAL: 720, PROT: 48 },
        },
      ],
    },
  });
  expect(lunch.status()).toBe(201);
  const body = (await lunch.json()) as { meal: { id: string; items: { id: string }[] } };
  mealId = body.meal.id;
  itemId = body.meal.items[0].id;
});

test('dashboard shows the agent-logged lunch', async ({ page }) => {
  await login(page, USER_EMAIL, USER_PASSWORD);
  await expect(page.getByText('Chicken burrito bowl')).toBeVisible();
  await expect(page.getByText('Lunch', { exact: true })).toBeVisible();
});

test('editing the item in the UI pins it', async ({ page }) => {
  await login(page, USER_EMAIL, USER_PASSWORD);
  const row = page.locator('li', { hasText: 'Chicken burrito bowl' }).first();
  await row.hover();
  await row.getByRole('button', { name: 'Edit' }).click();
  const kcalInput = page.getByLabel(/kcal \/ unit/i);
  await kcalInput.fill('700');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('⌖')).toBeVisible(); // pinned marker
});

test('agent PATCH on the pinned item → 409, then override succeeds', async ({ request }) => {
  const blocked = await request.patch(`/api/meals/${mealId}/items/${itemId}`, {
    headers: { authorization: `Bearer ${tokenSecret}` },
    data: { nutrients: { KCAL: 650 } },
  });
  expect(blocked.status()).toBe(409);
  expect(await blocked.json()).toEqual({ error: 'Entry pinned by user' });

  const forced = await request.patch(`/api/meals/${mealId}/items/${itemId}`, {
    headers: { authorization: `Bearer ${tokenSecret}` },
    data: { nutrients: { KCAL: 650 }, override: true },
  });
  expect(forced.status()).toBe(200);
});

test('the Log shows the whole chain with an override badge', async ({ page }) => {
  await login(page, USER_EMAIL, USER_PASSWORD);
  await page.goto('/log');
  // Default filter: agents only — the agent's create and override are visible.
  await expect(page.getByText('override').first()).toBeVisible();
  const agentRows = page.locator('li', { hasText: 'Claude desktop' });
  expect(await agentRows.count()).toBeGreaterThanOrEqual(2);
  // Switching to "Everyone" also shows the user's pinning edit.
  await page.locator('select').first().selectOption('');
  await expect(page.locator('li', { hasText: 'you' }).first()).toBeVisible();
});

test('changing the target today leaves yesterday\'s checkmark unchanged', async ({ page, request }) => {
  const before = await daysStatus(request, todayStr(-1));
  expect(before).toBe('success'); // 900 kcal <= 2000, 45 prot >= 40

  const change = await request.put('/api/targets', {
    headers: { authorization: `Bearer ${tokenSecret}` },
    data: { values: { KCAL: 800, PROT: 40 } }, // yesterday's 900 kcal would fail this
  });
  expect(change.status()).toBe(201);

  const after = await daysStatus(request, todayStr(-1));
  expect(after).toBe('success'); // frozen against the old row

  await login(page, USER_EMAIL, USER_PASSWORD);
  await expect(page.getByTestId('streak')).toHaveText(/[1-9]/); // yesterday's ✓ still counts
});

test('sign out lands on the landing page promptly and ends the session', async ({ page }) => {
  await login(page, USER_EMAIL, USER_PASSWORD);
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  // Same-origin navigation must land quickly regardless of NEXTAUTH_URL's host.
  await page.waitForURL((url) => url.pathname === '/', { timeout: 10_000 });
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  // The session is really gone: app pages bounce straight back to /login.
  await page.goto('/dashboard');
  await page.waitForURL(/\/login/);
});

async function daysStatus(request: APIRequestContext, date: string): Promise<string> {
  const res = await request.get(`/api/days?from=${date}&to=${date}`, {
    headers: { authorization: `Bearer ${tokenSecret}` },
  });
  const body = (await res.json()) as { days: { status: string }[] };
  return body.days[0].status;
}
