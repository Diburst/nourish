#!/usr/bin/env node
/**
 * Nourish MCP server — a pure stdio wrapper over the Nourish REST API.
 * Nothing here bypasses the API; the bearer token's scopes are enforced server-side.
 *
 * Env: NOURISH_URL (e.g. http://nourish.tailnet.ts.net:3000), NOURISH_TOKEN (ntk_...).
 * Read tools are always registered; write tools only with --allow-writes.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const NOURISH_URL = (process.env.NOURISH_URL ?? '').replace(/\/$/, '');
const NOURISH_TOKEN = process.env.NOURISH_TOKEN ?? '';
const ALLOW_WRITES = process.argv.includes('--allow-writes');

if (!NOURISH_URL || !NOURISH_TOKEN) {
  console.error('NOURISH_URL and NOURISH_TOKEN must be set');
  process.exit(1);
}

/** Call the REST API. Errors come back as { "error": "..." } — never thrown. */
async function api(method: string, path: string, body?: unknown): Promise<unknown> {
  try {
    const res = await fetch(`${NOURISH_URL}/api${path}`, {
      method,
      headers: {
        authorization: `Bearer ${NOURISH_TOKEN}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status === 204) return { ok: true };
    const text = await res.text();
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { error: `Non-JSON response (${res.status})` };
    }
    if (!res.ok && (typeof payload !== 'object' || payload === null || !('error' in payload))) {
      return { error: `Request failed with status ${res.status}` };
    }
    return payload;
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Network error reaching Nourish' };
  }
}

function jsonResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

const server = new McpServer({ name: 'nourish', version: '1.0.0' });

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('YYYY-MM-DD in the user timezone');
const nutrientsField = z
  .record(z.string(), z.number())
  .describe(
    'Nutrition PER SINGLE UNIT as { CODE: amount }, e.g. { "KCAL": 720, "PROT": 48, "MG": 95 }. KCAL is kcal; get valid codes and units from list_nutrients. Totals are perUnit × quantity.'
  );

// ---------------- read tools (always available) ----------------

server.tool(
  'get_summary',
  'Nutrition summary: averages, kcal/protein day hits, weekly micro totals vs ×7, streak, weight EMA + slope, unlogged days, top shortfalls. range: 7d, 30d or 90d.',
  { range: z.enum(['7d', '30d', '90d']).default('7d') },
  async ({ range }) => jsonResult(await api('GET', `/summary?range=${range}`))
);

server.tool(
  'get_days',
  'Per-day detail for a date range: totals, success status, and every meal slot with its items.',
  { from: DATE, to: DATE },
  async ({ from, to }) => jsonResult(await api('GET', `/days?from=${from}&to=${to}`))
);

server.tool(
  'get_targets',
  'Current target row plus full effective-dated target history and the weight goal.',
  {},
  async () => {
    const [current, all, goal] = await Promise.all([
      api('GET', '/targets/current'),
      api('GET', '/targets'),
      api('GET', '/weight-goal'),
    ]);
    return jsonResult({ current, history: all, weightGoal: goal });
  }
);

server.tool(
  'get_suggestions',
  'Micros lagging behind weekly pace, each with matching guideline links (same data as the dashboard Suggestions card).',
  {},
  async () => jsonResult(await api('GET', '/suggestions'))
);

server.tool(
  'list_nutrients',
  'The user\'s nutrient list: code, display name, unit, kind (ENERGY/MACRO/MICRO), target rule (MIN/MAX/RANGE). Use these codes in meal items and targets.',
  { includeArchived: z.boolean().default(false) },
  async ({ includeArchived }) =>
    jsonResult(await api('GET', `/nutrients${includeArchived ? '?archived=true' : ''}`))
);

server.tool(
  'get_guidelines',
  'All shared guideline sections (Markdown bodies + ingredient links). Guidelines are global across users.',
  {},
  async () => jsonResult(await api('GET', '/guidelines'))
);

server.tool(
  'get_activity',
  'The EntryRevision audit feed (50/page). Filters: actor ("user" | "agents" | a token id), entityType, from/to dates, cursor.',
  {
    cursor: z.string().optional(),
    actor: z.string().optional(),
    entityType: z.string().optional(),
    from: DATE.optional(),
    to: DATE.optional(),
  },
  async (args) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(args)) if (v) params.set(k, String(v));
    const qs = params.toString();
    return jsonResult(await api('GET', `/activity${qs ? `?${qs}` : ''}`));
  }
);

server.tool(
  'get_weights',
  'Raw daily weight entries (kg) for a date range.',
  { from: DATE, to: DATE },
  async ({ from, to }) => jsonResult(await api('GET', `/weights?from=${from}&to=${to}`))
);

// ---------------- write tools (only with --allow-writes) ----------------

if (ALLOW_WRITES) {
  server.tool(
    'log_meal',
    'Log items into a meal slot. A meal is a SLOT unique per (date, mealType) — one Lunch per day; SNACK and DRINK each hold everything snacked/drunk that day. POSTing again appends items. NEVER send duplicate items — for two of the same thing, use quantity: 2. Item nutrition is per single unit. Set idempotencyKey per item (e.g. "2026-08-24-lunch-bowl") so retries are safe.',
    {
      date: DATE.optional().describe('Defaults to today in the user timezone'),
      mealType: z.string().describe('Meal type code, e.g. BREAKFAST, LUNCH, DINNER, SNACK, DRINK'),
      items: z
        .array(
          z.object({
            idempotencyKey: z.string().optional(),
            name: z.string(),
            quantity: z.number().positive().default(1),
            notes: z.string().optional(),
            nutrients: nutrientsField,
          })
        )
        .min(1),
      onConflict: z
        .enum(['replace', 'increment'])
        .optional()
        .describe('What to do if an identical item name already exists in the slot; omit to get a 409 error back'),
    },
    async (args) => jsonResult(await api('POST', '/meals', args))
  );

  server.tool(
    'add_meal_item',
    'Append one item to an existing meal by meal id. Duplicate names return an error unless onConflict is set. Nutrition is per single unit; never send duplicate items — use quantity.',
    {
      mealId: z.string(),
      name: z.string(),
      quantity: z.number().positive().default(1),
      idempotencyKey: z.string().optional(),
      notes: z.string().optional(),
      nutrients: nutrientsField,
      onConflict: z.enum(['replace', 'increment']).optional(),
    },
    async ({ mealId, ...rest }) => jsonResult(await api('POST', `/meals/${mealId}/items`, rest))
  );

  server.tool(
    'update_meal_item',
    'Correct an item\'s name, quantity or per-unit nutrients. If the user pinned the item you get { error: "Entry pinned by user" } — set override: true only when the user asked for the change (the override is recorded).',
    {
      mealId: z.string(),
      itemId: z.string(),
      name: z.string().optional(),
      quantity: z.number().positive().optional(),
      notes: z.string().optional(),
      nutrients: z.record(z.string(), z.number()).optional(),
      override: z.boolean().optional(),
    },
    async ({ mealId, itemId, ...rest }) =>
      jsonResult(await api('PATCH', `/meals/${mealId}/items/${itemId}`, rest))
  );

  server.tool(
    'delete_meal_item',
    'Soft-delete an item from a meal. Pinned items need override: true.',
    { mealId: z.string(), itemId: z.string(), override: z.boolean().optional() },
    async ({ mealId, itemId, override }) =>
      jsonResult(await api('DELETE', `/meals/${mealId}/items/${itemId}${override ? '?override=true' : ''}`))
  );

  server.tool(
    'log_activity',
    "Log a workout/activity that bumps TODAY'S (or a past day's) energy and protein allowance by a plain offset — the baseline target is untouched and tomorrow starts at zero. For a ONE-DAY fuelling bump, use this; for a LASTING change to the everyday goal, use set_targets. Ask the user for a protein figure and pass proteinG in the SAME call (it defaults to 0). Future dates are rejected — 'from now on' means set_targets.",
    {
      date: DATE.optional().describe('Defaults to today. Past dates OK; future dates rejected.'),
      kcal: z.number().int().min(0).max(5000).describe('Active kilocalories burned (not kilojoules)'),
      proteinG: z.number().int().min(0).max(300).optional().describe('Extra protein grams — ask the user and supply it in the same call'),
      label: z.string().optional().describe('Short human label, e.g. "10k run"'),
      minutes: z.number().int().optional(),
      externalId: z.string().optional(),
      idempotencyKey: z.string().optional(),
    },
    async (args) => jsonResult(await api('POST', '/activities', args))
  );

  server.tool(
    'update_activity',
    "Correct an activity entry's kcal, proteinG, label or minutes by id. The day's roll-up recomputes automatically.",
    {
      id: z.string(),
      kcal: z.number().int().min(0).max(5000).optional(),
      proteinG: z.number().int().min(0).max(300).optional(),
      label: z.string().optional(),
      minutes: z.number().int().optional(),
    },
    async ({ id, ...rest }) => jsonResult(await api('PATCH', `/activities/${id}`, rest))
  );

  server.tool(
    'delete_activity',
    "Soft-delete an activity entry by id. The day's allowance drops back accordingly.",
    { id: z.string() },
    async ({ id }) => jsonResult(await api('DELETE', `/activities/${id}`))
  );

  server.tool(
    'log_weight',
    'Log the day\'s weight (one per day; latest write wins). Send weightUnit: "lb" or "kg" — the server stores kg. Pinned days need override: true.',
    {
      date: DATE.optional(),
      value: z.number().positive(),
      weightUnit: z.enum(['lb', 'kg']).optional().describe('Defaults to the user\'s display unit'),
      idempotencyKey: z.string().optional(),
      override: z.boolean().optional(),
    },
    async (args) => jsonResult(await api('POST', '/weights', args))
  );

  server.tool(
    'set_targets',
    'Set nutrient targets going forward (append-only; past days keep the targets they were scored against). values maps nutrient code → number, or { min, max } for RANGE rules. Codes must exist in list_nutrients. This is for LASTING changes that carry forward — for a one-day fuelling bump after a workout, use log_activity instead.',
    {
      effectiveFrom: DATE.optional().describe('Defaults to today'),
      values: z.record(z.string(), z.union([z.number(), z.object({ min: z.number(), max: z.number() })])),
    },
    async (args) => jsonResult(await api('PUT', '/targets', args))
  );

  server.tool(
    'set_weight_goal',
    'Set the weight goal (append-only, like targets). direction: LOSE, GAIN or MAINTAIN.',
    {
      effectiveFrom: DATE.optional(),
      target: z.number().positive(),
      weightUnit: z.enum(['lb', 'kg']).optional(),
      direction: z.enum(['LOSE', 'GAIN', 'MAINTAIN']),
    },
    async (args) => jsonResult(await api('PUT', '/weight-goal', args))
  );

  server.tool(
    'add_nutrient',
    'Add a nutrient to the user\'s tracked list (or un-archive an existing code). kind: ENERGY, MACRO or MICRO; targetRule: MIN, MAX or RANGE.',
    {
      code: z.string().regex(/^[A-Z0-9_]+$/),
      displayName: z.string(),
      unit: z.string(),
      kind: z.enum(['ENERGY', 'MACRO', 'MICRO']),
      targetRule: z.enum(['MIN', 'MAX', 'RANGE']),
    },
    async (args) => jsonResult(await api('POST', '/nutrients', args))
  );

  server.tool(
    'create_guideline_section',
    'Create a new shared guideline section (kebab-case slug, e.g. pantry-staples).',
    {
      slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      title: z.string(),
      body: z.string().default(''),
    },
    async (args) => jsonResult(await api('POST', '/guidelines', args))
  );

  server.tool(
    'update_guidelines',
    'Update a guideline section. Provide body to replace the whole section, or heading + content to append-or-replace one "## heading" block.',
    {
      slug: z.string(),
      body: z.string().optional(),
      heading: z.string().optional(),
      content: z.string().optional(),
    },
    async ({ slug, body, heading, content }) => {
      if (body !== undefined) return jsonResult(await api('PUT', `/guidelines/${slug}`, { body }));
      if (heading !== undefined && content !== undefined) {
        return jsonResult(await api('PATCH', `/guidelines/${slug}`, { heading, content }));
      }
      return jsonResult({ error: 'Provide either body, or heading + content' });
    }
  );

  server.tool(
    'set_guideline_links',
    'Replace a section\'s ingredient links: [{ label: "Pumpkin seeds", nutrients: ["MG","ZN"] }]. These power the dashboard Suggestions card.',
    {
      slug: z.string(),
      links: z.array(z.object({ label: z.string(), nutrients: z.array(z.string()) })),
    },
    async ({ slug, links }) => jsonResult(await api('PUT', `/guidelines/${slug}/links`, { links })),
  );
}

const transport = new StdioServerTransport();
server.connect(transport).catch((e) => {
  console.error('Failed to start Nourish MCP server:', e);
  process.exit(1);
});
