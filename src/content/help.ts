/**
 * Help content: one source for the drawer (HelpButton / InfoDot) and the /help
 * page. Paragraphs are separated by blank lines; no markdown engine needed.
 */

export interface HelpTopic {
  title: string;
  body: string;
  related: HelpTopicId[];
}

export const HELP_TOPICS = {
  'what-nourish-is': {
    title: 'What Nourish is',
    body: `Nourish has no food diary. You tell your agent what you ate, weighed, or did; the agent writes it here; this app is where you see what it means — trends, streaks, and what you're consistently short on.

The agent is the primary writer. The Add buttons in the app exist for the moments your agent isn't around, not as the main flow.`,
    related: ['pairing-an-agent', 'revision-log'],
  },
  'pairing-an-agent': {
    title: 'Pairing an agent',
    body: `Create a token in Settings → API tokens, then in Claude: Settings → Connectors → Add custom connector. Paste the connector URL, leave the OAuth fields blank, and paste your ntk_ token on the consent page.

The onboarding page (Finish setup) walks these steps with live status — it flips green the moment your agent makes its first call.`,
    related: ['tokens-and-security', 'connector-troubleshooting'],
  },
  'tokens-and-security': {
    title: 'Tokens and security',
    body: `A token is your agent's password to your data — it is shown once at creation and only a hash is stored. Treat it like a password; revoke it in Settings if it leaks.

Tokens carry scopes (read, write, targets, guidelines), so you can make a read-only token for an agent that should only summarize.`,
    related: ['revoking-last-token', 'privacy'],
  },
  'revoking-last-token': {
    title: 'What happens if you revoke your last token',
    body: `The app keeps working — you can browse everything, and nothing is deleted. But no agent can write anymore, so nothing new gets logged.

A reconnect banner appears on every page until you create a new token and pair an agent again. It links straight to Settings → API tokens.`,
    related: ['tokens-and-security', 'pairing-an-agent'],
  },
  'targets-effective-dating': {
    title: 'Targets and effective dating',
    body: `Targets are append-only: setting new targets starts a new row "from today" (or a date you choose) and closes the previous one. Past days keep the targets they were scored against — changing your goal never rewrites history.

This is why a day last month can be green under 2,000 kcal while today is scored against 2,300.`,
    related: ['adjustments-vs-targets', 'week-success'],
  },
  'adjustments-vs-targets': {
    title: 'Activity adjustments vs. target changes',
    body: `A workout bumps that one day's calorie and protein allowance — that's an activity adjustment. It shows up as "+400 from activity" beside your unchanged baseline, and tomorrow starts back at zero.

A target change ("my goal is 2,500 now") carries forward every day until you change it again.

Keeping these separate is deliberate: a run should never permanently raise your everyday goal. If your agent seems to have done that, check Log for a TARGET entry and ask it to fix the baseline.`,
    related: ['targets-effective-dating', 'blank-day-rule'],
  },
  'blank-day-rule': {
    title: 'The blank-day rule',
    body: `Days with nothing logged, days before your account existed, and days with no target are blank — never red. Only a logged day with a target can fail.

This also applies to activity: logging a workout on a day with no baseline target leaves the day blank. The adjustment alone doesn't make a day scoreable.`,
    related: ['week-success', 'adjustments-vs-targets'],
  },
  'week-success': {
    title: 'How week success is calculated',
    body: `A week (Monday–Sunday) succeeds when every logged day succeeded AND each tracked micronutrient's weekly total reaches its daily target × 7 — the ×7 is flat, regardless of how many days you logged.

A day succeeds when calories are at or under target and protein at or over — using that day's adjusted allowance if you logged activity. Micros never affect day success; they only matter weekly.`,
    related: ['blank-day-rule', 'adjustments-vs-targets'],
  },
  guidelines: {
    title: 'Guidelines',
    body: `Guidelines are shared markdown pages — pantry staples, meal ideas, house rules — editable by you or your agent, with full revision history and revert.

Ingredient links inside them ("Pumpkin seeds → MG, ZN") power the Suggestions card: when a micro lags, foods whose links mention it surface automatically.`,
    related: ['what-nourish-is'],
  },
  'weight-ema': {
    title: 'Weight EMA',
    body: `The weight chart shows your raw daily entries and a 7-day exponential moving average. Daily weight is noisy (water, salt, timing); the EMA is the trend worth reading.

The slope figure is the EMA's change per week — a steadier answer to "is it moving?" than any single morning's number.`,
    related: ['what-nourish-is'],
  },
  'revision-log': {
    title: 'The revision log',
    body: `Every write — by you or any agent — lands in the Log with what changed, who changed it, and the values before and after. Nothing is ever hard-deleted; deletes are recorded and reversible in data terms.

Entries you edit by hand are pinned: agents can't change them without an explicit override, and overrides are recorded too.`,
    related: ['privacy'],
  },
  privacy: {
    title: 'Privacy',
    body: `Admins manage accounts, invites, and backups — they can never see nutrition data. Nutrition endpoints refuse admin credentials outright.

Analytics, when enabled, records event names only (like "meal logged"), never food, weights, or any nutrition payload.`,
    related: ['tokens-and-security', 'revision-log'],
  },
  'connector-troubleshooting': {
    title: 'Connector troubleshooting',
    body: `"Couldn't reach the MCP server" means discovery failed — re-check the connector URL, including https and the /api/mcp path.

"Couldn't register with sign-in service" means the registration call failed — the /oauth and /.well-known paths aren't reachable from outside. If you're publishing via Tailscale Funnel, check those mounts.

After revoking and re-creating a token, reconnect the connector in Claude with the new token — the old grant stops working the moment the token is revoked.`,
    related: ['pairing-an-agent', 'tokens-and-security'],
  },
} as const satisfies Record<string, { title: string; body: string; related: readonly string[] }>;

export type HelpTopicId = keyof typeof HELP_TOPICS;

export const HELP_TOPIC_IDS = Object.keys(HELP_TOPICS) as HelpTopicId[];
