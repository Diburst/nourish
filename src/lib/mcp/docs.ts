/**
 * Agent-facing playbooks served by the get_docs tool (and mirrored as MCP resources
 * at nourish://docs/{topic}). Plain strings compiled into the bundle — no DB, no fs.
 *
 * Style rule: each playbook is written as "the user says X → call Y then Z", with
 * real JSON. These teach the agent at the moment it is confused; keep them concrete.
 */

export const DOC_TOPICS = [
  'overview',
  'logging-meals',
  'targets-vs-adjustments',
  'weight',
  'activity',
  'summaries',
  'guidelines',
  'nutrients',
  'conventions',
  'errors',
  'onboarding',
] as const;

export type DocTopic = (typeof DOC_TOPICS)[number];

const overview = `# Nourish overview

Nourish is a nutrition tracker with no food diary UI: **the agent is the primary writer**. The human tells you what they ate, weighed, or did; you log it; they read the trends on their dashboard.

The data model in five lines:
- Meals are **slots**, unique per (date, mealType) — one Lunch per day; SNACK and DRINK each hold everything snacked/drunk that day.
- Item nutrition is **per single unit × quantity** — never send duplicate items, use \`quantity\`.
- Targets are **append-only and effective-dated** — past days keep the targets they were scored against.
- Every write is **soft-deleted and revisioned** — nothing is ever destroyed, and the user sees an audit feed.
- Dates are the **user's local calendar date**, \`YYYY-MM-DD\`.

Golden rules:
1. Call \`list_nutrients\` and \`get_targets\` before your first write of a session.
2. Never invent nutrient codes — codes come from \`list_nutrients\`.
3. Always pass an \`idempotencyKey\` on writes so retries are safe.
4. A workout raises **today's** energy/protein allowance only → \`log_activity\`. A lasting goal change → \`set_targets\`. See \`get_docs("targets-vs-adjustments")\`.

Other topics: ${'`' + DOC_TOPICS.join('` · `') + '`'}.`;

const loggingMeals = `# Logging meals

The user says: "Log my lunch: chicken bowl and a coke."

1. \`list_nutrients\` (once per session) → learn the codes: KCAL, PROT, and the user's tracked micros.
2. \`log_meal\`:
\`\`\`json
{
  "mealType": "LUNCH",
  "items": [
    { "idempotencyKey": "2026-08-28-lunch-bowl", "name": "Chicken burrito bowl", "quantity": 1,
      "nutrients": { "KCAL": 720, "PROT": 48, "MG": 95 } },
    { "idempotencyKey": "2026-08-28-lunch-coke", "name": "Coca-Cola 330ml", "quantity": 1,
      "nutrients": { "KCAL": 139 } }
  ]
}
\`\`\`

Rules that matter:
- **Nutrition is per single unit.** Two eggs = one item \`"name": "Egg", "quantity": 2\` with per-egg nutrients — never two "Egg" items.
- A meal is a **slot**: POSTing \`log_meal\` again for the same (date, mealType) appends items to it. To add one forgotten item to an existing meal, prefer \`add_meal_item\` with the \`mealId\` you got back.
- **Duplicate names** in a slot return an error. If the user really ate a second serving, re-send with \`"onConflict": "increment"\` (bumps quantity) or \`"replace"\` (corrected values win).
- Names are deduped case-insensitively on normalized whitespace ("chicken  Bowl" == "Chicken bowl").
- Corrections: \`update_meal_item\` with per-unit nutrients; \`delete_meal_item\` soft-deletes ("actually I didn't have the coke"). If either returns \`{ "error": "Entry pinned by user" }\`, the human edited it in the UI — only set \`"override": true\` when they explicitly asked you to change it.
- \`date\` defaults to today in the user's timezone; pass it explicitly when logging yesterday's dinner.`;

const targetsVsAdjustments = `# Targets vs. day adjustments — the distinction that matters most

Two different things can raise "how much should I eat today":

**A workout happened** → \`log_activity\`. Bumps that ONE day's energy and protein allowance by a plain offset. Never carries forward; tomorrow starts at zero; the baseline target history is untouched. The dashboard shows the baseline unchanged with "+400 from activity" beside it.

**The everyday goal changed** → \`set_targets\`. Append-only, effective-dated, carries forward until changed again. Past days keep the targets they were scored against.

The user says: "I ran 10k this morning, about 700 calories" →
\`\`\`json
{ "kcal": 700, "proteinG": 25, "label": "10k run", "minutes": 52,
  "idempotencyKey": "2026-08-28-morning-run" }
\`\`\`
Ask for the protein figure and pass \`proteinG\` **in the same call** — it defaults to 0, not to a derived value.

The user says: "Bump my calories to 2,500 from now on" →
\`\`\`json
{ "values": { "KCAL": 2500 } }
\`\`\`

Tells:
- "today", "this morning", "after my run" → activity.
- "from now on", "going forward", "my new goal" → targets.
- A **future date** on \`log_activity\` is rejected — a future date almost always means "from now on", which is \`set_targets\`. Past dates are fine (logging last night's run this morning is normal).

Never call \`set_targets\` because of a single workout. That permanently raises the baseline — the exact mistake this page exists to prevent.`;

const weight = `# Weight

One entry per calendar day; the latest write wins. The server stores kg; send the unit the user spoke in.

The user says: "My weight this morning was 78.4 kg" →
\`\`\`json
{ "value": 78.4, "weightUnit": "kg", "idempotencyKey": "2026-08-28-weight" }
\`\`\`

- \`date\` defaults to today; pass it for a back-dated entry ("I forgot to log Tuesday — 79.1").
- If the result is \`{ "error": "Entry pinned by user" }\`, the human entered that day's weight themselves. Only \`"override": true\` when they ask you to correct it.
- The dashboard shows a 7-day EMA and its weekly slope, so day-to-day noise is expected — log the raw number, never "smooth" it yourself. Raw entries for a range come back from \`get_weights\` \`{ "from": "2026-08-01", "to": "2026-08-28" }\`.
- \`set_weight_goal\` records the goal (target + direction LOSE/GAIN/MAINTAIN), append-only like targets.`;

const activity = `# Activity — the three-tool trio

\`log_activity\` / \`update_activity\` / \`delete_activity\` mirror the meal-item trio. Multiple activities per day are normal; the day's adjustment is the sum.

The user says: "I ran 10 km this morning, about 700 active calories and I want 25 g extra protein" →
\`\`\`json
{ "kcal": 700, "proteinG": 25, "label": "10k run",
  "idempotencyKey": "2026-08-28-10k-run" }
\`\`\`

Rules:
- **kcal** is active kilocalories (0–5000 per entry), whole numbers, kilocalories not kilojoules.
- **proteinG defaults to 0 when omitted.** There is no derived default — ask the user for a protein figure and supply it **in the same call**, not as a follow-up write.
- **Future dates are rejected** with a teaching error. "More calories from tomorrow on" is \`set_targets\`, not an activity.
- Past dates are allowed: "log last night's run" → \`{ "date": "2026-08-27", "kcal": 700 }\`.
- The adjustment applies to that one calendar day only, on top of the baseline target. It never touches the target history.
- A day with an adjustment but **no baseline target** stays blank on the calendar — the adjustment alone does not make a day evaluable.
- Corrections: \`update_activity\` with the id from \`log_activity\` or \`get_days\` → \`activities[]\`. Deleting drops the day's allowance back automatically.
- Read back: \`get_days\` gives per-day \`activityAdjustmentKcal\`, \`activityAdjustmentProteinG\`, \`activities[]\`, and \`adjustedTarget\` alongside the unchanged baseline \`target\`.`;

const summaries = `# Summaries and reading data

"How did I do this week?" → \`get_summary\` with \`{ "range": "7d" }\`:
- \`kcal\`/\`prot\` day-hit counts and \`weeks[]\` (Mon–Sun) — evaluated against **base + activity adjustment**, so a 700 kcal run day does not read as an overshoot.
- \`weeks[].micros\` — weekly micro totals vs daily-target ×7, plus live pace.
- \`streak\`, \`weight.ema\` + \`slopeKgPerWeek\`, \`unloggedDays\`, \`topShortfalls\`.
- \`activity\` — adjustment totals and a days-with-activity count for the range.

"What am I consistently short on?" → \`get_suggestions\` — lagging micros with matching guideline links (same data as the dashboard card).

Per-day detail → \`get_days\` with \`{ "from": "2026-08-22", "to": "2026-08-28" }\`: totals, status (success/fail/pending/blank), every meal slot with items, weight, activities, and both \`target\` (baseline) and \`adjustedTarget\`.

Scoring rules worth knowing before you editorialize:
- Day success = KCAL ≤ target AND PROT ≥ target (adjusted values). Micros never affect day success.
- Week success = every logged day succeeded AND weekly micro cumulative ≥ daily ×7.
- Unlogged days and days with no covering target are **blank, never red** — don't describe them as failures.
- The audit feed (\`get_activity\` — note: revisions, not workouts) shows who changed what, including your own writes.`;

const guidelines = `# Guidelines

Shared, global markdown sections (not per-user): pantry staples, meal ideas, house rules. Read with \`get_guidelines\`; you need \`guidelines:read\` scope.

Structure: sections (slug + title + markdown body) with **ingredient links** — \`[{ "label": "Pumpkin seeds", "nutrients": ["MG", "ZN"] }]\` — that power the dashboard Suggestions card: a lagging micro surfaces foods whose links mention it.

The user says: "Add sardines to the pantry staples as an iron and omega-3 source" →
1. \`get_guidelines\` → find the section slug (\`pantry-staples\`).
2. \`update_guidelines\` with \`{ "slug": "pantry-staples", "heading": "Sardines", "content": "Tinned sardines: ~IRON 2.9mg per tin..." }\` (append-or-replace one "## heading" block), or \`body\` to replace the whole section.
3. \`set_guideline_links\` to REPLACE the section's links array — read it first, append the new entry, send the whole array back.

Creating a new section: \`create_guideline_section\` with a kebab-case slug.`;

const nutrients = `# Nutrients

Codes are per-user and come from \`list_nutrients\` — **never invent one**. Each has: code (e.g. \`KCAL\`, \`PROT\`, \`MG\`), display name, unit, kind (ENERGY/MACRO/MICRO), and target rule (MIN/MAX/RANGE).

- KCAL is kilocalories (rule MAX — a ceiling). PROT is grams (rule MIN — a floor). Micros are usually MIN; RANGE has { min, max }.
- Unknown code in a write → error listing the valid codes in \`fix\`. Re-check \`list_nutrients\`; the user may track fewer micros than you assume.
- The user starts tracking something new ("track zinc") → \`add_nutrient\` with \`{ "code": "ZN", "displayName": "Zinc", "unit": "mg", "kind": "MICRO", "targetRule": "MIN" }\`, then usually \`set_targets\` to give it a goal.
- Archived nutrients keep their history; \`add_nutrient\` with an existing code un-archives it.
- When logging items, include the micros the user tracks when you can estimate them credibly — micros power the Suggestions card. Don't fabricate precision.`;

const conventions = `# Conventions

- **Dates**: \`YYYY-MM-DD\`, the user's local calendar date (their stored timezone). Omitted \`date\` fields default to today.
- **Units**: KCAL kilocalories; PROT grams; weight kg stored, \`weightUnit\` "lb"/"kg" accepted; nutrient amounts in the unit \`list_nutrients\` declares.
- **Quantity**: item nutrients are per single unit; totals are per-unit × quantity.
- **Idempotency**: pass \`idempotencyKey\` (unique per logical entry, e.g. \`"2026-08-28-lunch-bowl"\`) on every write. Retrying the same key returns the existing entry instead of duplicating.
- **Pinning**: entries the human edited in the UI are pinned; agent changes to them need \`"override": true\` and are recorded as overrides. Only override when asked.
- **Scopes**: your token holds scopes (nutrition:read/write, targets:write, guidelines:read/write). Tools you lack scopes for are not listed.
- **Rate budget**: writes ~120/min — batch items into one \`log_meal\` call rather than many.
- **Audit**: every write lands in the revision feed the user can read. Write what you'd be happy to have read back.`;

const errors = `# Errors

Tool errors come back as JSON with \`error\` (human-readable), and often \`code\` and \`fix\` (machine-readable + what to do). Common ones:

- \`{ "error": "Unknown nutrient codes: ..." }\` → you invented a code. Call \`list_nutrients\`, use \`fix\`'s list.
- \`{ "error": "Entry pinned by user" }\` → the human edited it. Ask before overriding; then \`"override": true\`.
- Duplicate item name in a slot → add \`"onConflict": "increment"\` (second serving) or \`"replace"\` (correction).
- \`{ "code": "FUTURE_DATE" }\` on \`log_activity\` → you meant a lasting change: use \`set_targets\`, or drop the date for today.
- kcal/proteinG out of range (0–5000 / 0–300 per activity entry) → almost certainly a mis-key; re-check with the user.
- 401 → token revoked or invalid; the user must create a token in Settings → API tokens and re-pair.
- 429 → rate budget hit; back off and batch.
- \`_hint\` fields on results are nudges about incomplete setup (no targets, no weight) — act on them: ask the user, then call the named tool.`;

const onboarding = `# Onboarding a new account

A fresh account has no targets, no weight, no meals. The app shows the human copyable prompts; here is what each should make you do:

- "Set my daily targets to 2,300 kcal and 160 g protein, starting today."
  → \`set_targets\` \`{ "values": { "KCAL": 2300, "PROT": 160 } }\`
- "My weight this morning was 78.4 kg."
  → \`log_weight\` \`{ "value": 78.4, "weightUnit": "kg" }\`
- "Log my breakfast: three eggs, two slices of sourdough, black coffee."
  → \`list_nutrients\`, then \`log_meal\` with per-unit nutrients and quantities (eggs: quantity 3).
- "I ran 10 km this morning, about 700 active calories and I want 25 g extra protein."
  → \`log_activity\` \`{ "kcal": 700, "proteinG": 25, "label": "10k run" }\` — one call, both numbers.
- "How did I do this week?" → \`get_summary\` \`{ "range": "7d" }\`.
- "What am I consistently short on?" → \`get_suggestions\`.

Sequence for a brand-new account: \`list_nutrients\` → \`get_targets\` (empty) → ask the user for energy + protein goals → \`set_targets\` → \`log_weight\` → start logging meals. Results carry \`_hint\` fields while setup is incomplete — follow them.

Your first successful call is also the pairing signal the onboarding screen is polling for — the human sees "Waiting for your agent…" flip green.`;

export const DOCS: Record<DocTopic, string> = {
  overview,
  'logging-meals': loggingMeals,
  'targets-vs-adjustments': targetsVsAdjustments,
  weight,
  activity,
  summaries,
  guidelines,
  nutrients,
  conventions,
  errors,
  onboarding,
};

export function docsIndex(): string {
  return `# Nourish agent docs

Topics (request one with get_docs {"topic": "..."}):
${DOC_TOPICS.map((t) => `- \`${t}\``).join('\n')}

---

${DOCS.overview}`;
}

export function getDoc(topic?: string): { ok: true; markdown: string } | { ok: false; error: string } {
  if (!topic) return { ok: true, markdown: docsIndex() };
  if ((DOC_TOPICS as readonly string[]).includes(topic)) {
    return { ok: true, markdown: DOCS[topic as DocTopic] };
  }
  return { ok: false, error: `Unknown topic: ${topic}. Valid topics: ${DOC_TOPICS.join(', ')}` };
}
