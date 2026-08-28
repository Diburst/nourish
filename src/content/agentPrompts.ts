/**
 * The shared agent-prompt vocabulary. One source used by /onboarding, the help
 * drawer, and every empty state — and mirrored in get_docs('onboarding') — so the
 * agent and the interface teach one vocabulary.
 *
 * Note the activity prompt models supplying protein alongside calories: the copy
 * is doing teaching work.
 */

export interface AgentPrompt {
  id: string;
  /** What the prompt accomplishes, for labels ("Set your targets"). */
  label: string;
  text: string;
}

export const AGENT_PROMPTS = {
  setTargets: {
    id: 'setTargets',
    label: 'Set your daily targets',
    text: 'Set my daily targets to 2,300 kcal and 160 g protein, starting today.',
  },
  logWeight: {
    id: 'logWeight',
    label: 'Log your weight',
    text: 'My weight this morning was 78.4 kg.',
  },
  logMeal: {
    id: 'logMeal',
    label: 'Log a meal',
    text: 'Log my breakfast: three eggs, two slices of sourdough, black coffee.',
  },
  logActivity: {
    id: 'logActivity',
    label: 'Log a workout',
    text: 'I ran 10 km this morning, about 700 active calories and I want 25 g extra protein.',
  },
  weeklyReview: {
    id: 'weeklyReview',
    label: 'Review your week',
    text: 'How did I do this week?',
  },
  shortfalls: {
    id: 'shortfalls',
    label: 'Find shortfalls',
    text: 'What am I consistently short on?',
  },
} as const satisfies Record<string, AgentPrompt>;

export type AgentPromptId = keyof typeof AGENT_PROMPTS;

/** The prompts shown on the onboarding completion screen, in order. */
export const COMPLETION_PROMPTS: AgentPrompt[] = [
  AGENT_PROMPTS.logMeal,
  AGENT_PROMPTS.logActivity,
  AGENT_PROMPTS.weeklyReview,
  AGENT_PROMPTS.shortfalls,
];
