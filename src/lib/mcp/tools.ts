/**
 * The Nourish MCP tool registry, shared by the HTTP endpoint (/api/mcp) and kept in
 * lockstep with the stdio package in mcp/. Every tool is a pure wrapper over the REST
 * routes — nothing bypasses the API, so token scopes, pinning, rate limits and
 * EntryRevisions all apply exactly as they do for any other client.
 */
import { NextRequest, NextResponse } from 'next/server';

import { POST as postMeals } from '@/app/api/meals/route';
import { POST as postItem } from '@/app/api/meals/[id]/items/route';
import { PATCH as patchItem, DELETE as deleteItem } from '@/app/api/meals/[id]/items/[itemId]/route';
import { GET as getDays } from '@/app/api/days/route';
import { GET as getWeights, POST as postWeight } from '@/app/api/weights/route';
import { GET as getTargets, PUT as putTargets } from '@/app/api/targets/route';
import { GET as getCurrentTarget } from '@/app/api/targets/current/route';
import { GET as getWeightGoal, PUT as putWeightGoal } from '@/app/api/weight-goal/route';
import { GET as getNutrients, POST as postNutrient } from '@/app/api/nutrients/route';
import { GET as getSummary } from '@/app/api/summary/route';
import { GET as getSuggestions } from '@/app/api/suggestions/route';
import { GET as getActivity } from '@/app/api/activity/route';
import { GET as getGuidelines, POST as postGuideline } from '@/app/api/guidelines/route';
import { PUT as putGuideline, PATCH as patchGuideline } from '@/app/api/guidelines/[slug]/route';
import { PUT as putGuidelineLinks } from '@/app/api/guidelines/[slug]/links/route';

type Handler = (req: NextRequest, ctx: { params: Record<string, string> }) => Promise<NextResponse>;
type Json = Record<string, unknown>;

export interface McpToolResult {
  status: number;
  body: unknown;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Json;
  /** Scopes the bearer token must hold for the tool to be listed. */
  requiredScopes: string[];
  run: (args: Json, token: string) => Promise<McpToolResult>;
}

/** Invoke a route handler in-process with a synthetic bearer-authenticated request. */
async function internal(
  handler: Handler,
  method: string,
  path: string,
  token: string,
  body?: unknown,
  params: Record<string, string> = {}
): Promise<McpToolResult> {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  let bodyStr: string | undefined;
  if (body !== undefined) {
    bodyStr = JSON.stringify(body);
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(Buffer.byteLength(bodyStr));
  }
  const req = new NextRequest(`http://mcp.internal${path}`, {
    method,
    headers,
    ...(bodyStr !== undefined ? { body: bodyStr } : {}),
  });
  const res = await handler(req, { params });
  const text = await res.text();
  let parsed: unknown = { ok: true };
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { error: `Non-JSON response (${res.status})` };
    }
  }
  return { status: res.status, body: parsed };
}

const DATE = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD in the user timezone' };
const NUTRIENTS_FIELD = {
  type: 'object',
  additionalProperties: { type: 'number' },
  description:
    'Nutrition PER SINGLE UNIT as { CODE: amount }, e.g. { "KCAL": 720, "PROT": 48, "MG": 95 }. Get valid codes and units from list_nutrients. Totals are perUnit × quantity.',
};
const str = (description?: string) => ({ type: 'string', ...(description ? { description } : {}) });
const num = (description?: string) => ({ type: 'number', ...(description ? { description } : {}) });
const bool = (description?: string) => ({ type: 'boolean', ...(description ? { description } : {}) });
const obj = (properties: Json, required: string[] = []): Json => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});

function qs(params: Record<string, string | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') usp.set(k, v);
  const s = usp.toString();
  return s ? `?${s}` : '';
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: 'get_summary',
    description:
      'Nutrition summary: averages, kcal/protein day hits, weekly micro totals vs ×7, streak, weight EMA + slope, unlogged days, top shortfalls. range: 7d, 30d or 90d.',
    inputSchema: obj({ range: { type: 'string', enum: ['7d', '30d', '90d'], default: '7d' } }),
    requiredScopes: ['nutrition:read'],
    run: (args, token) => internal(getSummary, 'GET', `/api/summary?range=${(args.range as string) ?? '7d'}`, token),
  },
  {
    name: 'get_days',
    description: 'Per-day detail for a date range: totals, success status, and every meal slot with its items.',
    inputSchema: obj({ from: DATE, to: DATE }, ['from', 'to']),
    requiredScopes: ['nutrition:read'],
    run: (args, token) => internal(getDays, 'GET', `/api/days?from=${args.from}&to=${args.to}`, token),
  },
  {
    name: 'get_targets',
    description: 'Current target row plus full effective-dated target history and the weight goal.',
    inputSchema: obj({}),
    requiredScopes: ['nutrition:read'],
    run: async (_args, token) => {
      const [current, history, goal] = await Promise.all([
        internal(getCurrentTarget, 'GET', '/api/targets/current', token),
        internal(getTargets, 'GET', '/api/targets', token),
        internal(getWeightGoal, 'GET', '/api/weight-goal', token),
      ]);
      const bad = [current, history, goal].find((r) => r.status >= 400);
      if (bad) return bad;
      return { status: 200, body: { current: current.body, history: history.body, weightGoal: goal.body } };
    },
  },
  {
    name: 'get_suggestions',
    description: 'Micros lagging behind weekly pace, each with matching guideline links (same data as the dashboard Suggestions card).',
    inputSchema: obj({}),
    requiredScopes: ['nutrition:read'],
    run: (_args, token) => internal(getSuggestions, 'GET', '/api/suggestions', token),
  },
  {
    name: 'list_nutrients',
    description:
      "The user's nutrient list: code, display name, unit, kind (ENERGY/MACRO/MICRO), target rule (MIN/MAX/RANGE). Use these codes in meal items and targets.",
    inputSchema: obj({ includeArchived: bool() }),
    requiredScopes: ['nutrition:read'],
    run: (args, token) =>
      internal(getNutrients, 'GET', `/api/nutrients${args.includeArchived ? '?archived=true' : ''}`, token),
  },
  {
    name: 'get_guidelines',
    description: 'All shared guideline sections (Markdown bodies + ingredient links). Guidelines are global across users.',
    inputSchema: obj({}),
    requiredScopes: ['guidelines:read'],
    run: (_args, token) => internal(getGuidelines, 'GET', '/api/guidelines', token),
  },
  {
    name: 'get_activity',
    description:
      'The EntryRevision audit feed (50/page). Filters: actor ("user" | "agents" | a token id), entityType, from/to dates, cursor.',
    inputSchema: obj({ cursor: str(), actor: str(), entityType: str(), from: DATE, to: DATE }),
    requiredScopes: ['nutrition:read'],
    run: (args, token) =>
      internal(
        getActivity,
        'GET',
        `/api/activity${qs({
          cursor: args.cursor as string,
          actor: args.actor as string,
          entityType: args.entityType as string,
          from: args.from as string,
          to: args.to as string,
        })}`,
        token
      ),
  },
  {
    name: 'get_weights',
    description: 'Raw daily weight entries (kg) for a date range.',
    inputSchema: obj({ from: DATE, to: DATE }, ['from', 'to']),
    requiredScopes: ['nutrition:read'],
    run: (args, token) => internal(getWeights, 'GET', `/api/weights?from=${args.from}&to=${args.to}`, token),
  },
  {
    name: 'log_meal',
    description:
      'Log items into a meal slot. A meal is a SLOT unique per (date, mealType) — one Lunch per day; SNACK and DRINK each hold everything snacked/drunk that day. POSTing again appends items. NEVER send duplicate items — for two of the same thing, use quantity: 2. Item nutrition is per single unit. Set idempotencyKey per item (e.g. "2026-08-24-lunch-bowl") so retries are safe.',
    inputSchema: obj(
      {
        date: DATE,
        mealType: str('Meal type code, e.g. BREAKFAST, LUNCH, DINNER, SNACK, DRINK'),
        items: {
          type: 'array',
          minItems: 1,
          items: obj(
            {
              idempotencyKey: str(),
              name: str(),
              quantity: num('Defaults to 1'),
              notes: str(),
              nutrients: NUTRIENTS_FIELD,
            },
            ['name', 'nutrients']
          ),
        },
        onConflict: {
          type: 'string',
          enum: ['replace', 'increment'],
          description: 'What to do if an identical item name already exists in the slot; omit to get an error back',
        },
      },
      ['mealType', 'items']
    ),
    requiredScopes: ['nutrition:write'],
    run: (args, token) => internal(postMeals, 'POST', '/api/meals', token, args),
  },
  {
    name: 'add_meal_item',
    description:
      'Append one item to an existing meal by meal id. Duplicate names return an error unless onConflict is set. Nutrition is per single unit; never send duplicate items — use quantity.',
    inputSchema: obj(
      {
        mealId: str(),
        name: str(),
        quantity: num('Defaults to 1'),
        idempotencyKey: str(),
        notes: str(),
        nutrients: NUTRIENTS_FIELD,
        onConflict: { type: 'string', enum: ['replace', 'increment'] },
      },
      ['mealId', 'name', 'nutrients']
    ),
    requiredScopes: ['nutrition:write'],
    run: (args, token) => {
      const { mealId, ...rest } = args;
      return internal(postItem, 'POST', `/api/meals/${mealId}/items`, token, rest, { id: String(mealId) });
    },
  },
  {
    name: 'update_meal_item',
    description:
      'Correct an item\'s name, quantity or per-unit nutrients. If the user pinned the item you get { "error": "Entry pinned by user" } — set override: true only when the user asked for the change (the override is recorded).',
    inputSchema: obj(
      {
        mealId: str(),
        itemId: str(),
        name: str(),
        quantity: num(),
        notes: str(),
        nutrients: { type: 'object', additionalProperties: { type: 'number' } },
        override: bool(),
      },
      ['mealId', 'itemId']
    ),
    requiredScopes: ['nutrition:write'],
    run: (args, token) => {
      const { mealId, itemId, ...rest } = args;
      return internal(patchItem, 'PATCH', `/api/meals/${mealId}/items/${itemId}`, token, rest, {
        id: String(mealId),
        itemId: String(itemId),
      });
    },
  },
  {
    name: 'delete_meal_item',
    description: 'Soft-delete an item from a meal. Pinned items need override: true.',
    inputSchema: obj({ mealId: str(), itemId: str(), override: bool() }, ['mealId', 'itemId']),
    requiredScopes: ['nutrition:write'],
    run: (args, token) =>
      internal(
        deleteItem,
        'DELETE',
        `/api/meals/${args.mealId}/items/${args.itemId}${args.override ? '?override=true' : ''}`,
        token,
        undefined,
        { id: String(args.mealId), itemId: String(args.itemId) }
      ),
  },
  {
    name: 'log_weight',
    description:
      'Log the day\'s weight (one per day; latest write wins). Send weightUnit: "lb" or "kg" — the server stores kg. Pinned days need override: true.',
    inputSchema: obj(
      {
        date: DATE,
        value: num(),
        weightUnit: { type: 'string', enum: ['lb', 'kg'], description: "Defaults to the user's display unit" },
        idempotencyKey: str(),
        override: bool(),
      },
      ['value']
    ),
    requiredScopes: ['nutrition:write'],
    run: (args, token) => internal(postWeight, 'POST', '/api/weights', token, args),
  },
  {
    name: 'set_targets',
    description:
      'Set nutrient targets going forward (append-only; past days keep the targets they were scored against). values maps nutrient code → number, or { min, max } for RANGE rules. Codes must exist in list_nutrients.',
    inputSchema: obj(
      {
        effectiveFrom: DATE,
        values: {
          type: 'object',
          additionalProperties: {
            oneOf: [
              { type: 'number' },
              obj({ min: num(), max: num() }, ['min', 'max']),
            ],
          },
        },
      },
      ['values']
    ),
    requiredScopes: ['targets:write'],
    run: (args, token) => internal(putTargets, 'PUT', '/api/targets', token, args),
  },
  {
    name: 'set_weight_goal',
    description: 'Set the weight goal (append-only, like targets). direction: LOSE, GAIN or MAINTAIN.',
    inputSchema: obj(
      {
        effectiveFrom: DATE,
        target: num(),
        weightUnit: { type: 'string', enum: ['lb', 'kg'] },
        direction: { type: 'string', enum: ['LOSE', 'GAIN', 'MAINTAIN'] },
      },
      ['target', 'direction']
    ),
    requiredScopes: ['targets:write'],
    run: (args, token) => internal(putWeightGoal, 'PUT', '/api/weight-goal', token, args),
  },
  {
    name: 'add_nutrient',
    description:
      "Add a nutrient to the user's tracked list (or un-archive an existing code). kind: ENERGY, MACRO or MICRO; targetRule: MIN, MAX or RANGE.",
    inputSchema: obj(
      {
        code: { type: 'string', pattern: '^[A-Z0-9_]+$' },
        displayName: str(),
        unit: str(),
        kind: { type: 'string', enum: ['ENERGY', 'MACRO', 'MICRO'] },
        targetRule: { type: 'string', enum: ['MIN', 'MAX', 'RANGE'] },
      },
      ['code', 'displayName', 'unit', 'kind', 'targetRule']
    ),
    requiredScopes: ['nutrition:write'],
    run: (args, token) => internal(postNutrient, 'POST', '/api/nutrients', token, args),
  },
  {
    name: 'create_guideline_section',
    description: 'Create a new shared guideline section (kebab-case slug, e.g. pantry-staples).',
    inputSchema: obj(
      { slug: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }, title: str(), body: str() },
      ['slug', 'title']
    ),
    requiredScopes: ['guidelines:write'],
    run: (args, token) => internal(postGuideline, 'POST', '/api/guidelines', token, { body: '', ...args }),
  },
  {
    name: 'update_guidelines',
    description:
      'Update a guideline section. Provide body to replace the whole section, or heading + content to append-or-replace one "## heading" block.',
    inputSchema: obj({ slug: str(), body: str(), heading: str(), content: str() }, ['slug']),
    requiredScopes: ['guidelines:write'],
    run: async (args, token) => {
      const slug = String(args.slug);
      if (args.body !== undefined) {
        return internal(putGuideline, 'PUT', `/api/guidelines/${slug}`, token, { body: args.body }, { slug });
      }
      if (args.heading !== undefined && args.content !== undefined) {
        return internal(
          patchGuideline,
          'PATCH',
          `/api/guidelines/${slug}`,
          token,
          { heading: args.heading, content: args.content },
          { slug }
        );
      }
      return { status: 400, body: { error: 'Provide either body, or heading + content' } };
    },
  },
  {
    name: 'set_guideline_links',
    description:
      'Replace a section\'s ingredient links: [{ "label": "Pumpkin seeds", "nutrients": ["MG","ZN"] }]. These power the dashboard Suggestions card.',
    inputSchema: obj(
      {
        slug: str(),
        links: {
          type: 'array',
          items: obj({ label: str(), nutrients: { type: 'array', items: { type: 'string' } } }, ['label', 'nutrients']),
        },
      },
      ['slug', 'links']
    ),
    requiredScopes: ['guidelines:write'],
    run: (args, token) =>
      internal(putGuidelineLinks, 'PUT', `/api/guidelines/${args.slug}/links`, token, { links: args.links }, {
        slug: String(args.slug),
      }),
  },
];

export function toolsForScopes(scopes: string[]): McpTool[] {
  return MCP_TOOLS.filter((t) => t.requiredScopes.every((s) => scopes.includes(s)));
}
