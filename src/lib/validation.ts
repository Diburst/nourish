import { z } from 'zod';
import { DATE_RE } from '@/lib/dates';

export const dateString = z.string().regex(DATE_RE, 'Expected YYYY-MM-DD');

export const codeString = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[A-Z0-9_]+$/, 'Codes are uppercase letters, digits and underscores');

export const nameString = z.string().trim().min(1).max(200);

export const nutrientAmounts = z.record(z.string(), z.number().finite().min(0)).refine(
  (o) => Object.keys(o).length > 0,
  { message: 'At least one nutrient amount is required' }
);

export const targetValue = z.union([
  z.number().finite().min(0),
  z.object({ min: z.number().finite().min(0), max: z.number().finite().min(0) }).refine((v) => v.min <= v.max, {
    message: 'min must be <= max',
  }),
]);

export const mealItemInput = z.object({
  idempotencyKey: z.string().min(1).max(200).optional(),
  name: nameString,
  quantity: z.number().finite().positive().max(1000).default(1),
  notes: z.string().max(2000).optional(),
  nutrients: nutrientAmounts,
});

export const onConflict = z.enum(['replace', 'increment']).optional();

export const postMealSchema = z.object({
  date: dateString.optional(),
  mealType: codeString,
  notes: z.string().max(2000).optional(),
  items: z.array(mealItemInput).min(1).max(50),
  onConflict,
});

export const postItemSchema = mealItemInput.extend({ onConflict });

export const patchItemSchema = z
  .object({
    name: nameString.optional(),
    quantity: z.number().finite().positive().max(1000).optional(),
    notes: z.string().max(2000).nullable().optional(),
    nutrients: z.record(z.string(), z.number().finite().min(0)).optional(),
    override: z.boolean().optional(),
  })
  .refine((o) => Object.keys(o).some((k) => k !== 'override'), { message: 'Nothing to update' });

/**
 * Activity entries. Range validation is the teaching guard against mis-keys: a
 * fat-fingered 7000 kcal returns an error rather than wrecking a week. There is
 * deliberately no cap setting — these bounds are it.
 */
const activityKcal = z
  .number()
  .int('kcal must be a whole number of kilocalories')
  .min(0)
  .max(5000, 'kcal must be 0–5000 per activity — above 5000 is almost certainly a mis-key; split a real ultra-event into multiple entries');
const activityProteinG = z
  .number()
  .int('proteinG must be whole grams')
  .min(0)
  .max(300, 'proteinG must be 0–300 per activity — above 300 is almost certainly a mis-key');

export const postActivitySchema = z.object({
  date: dateString.optional(),
  kcal: activityKcal,
  proteinG: activityProteinG.optional(),
  label: z.string().trim().min(1).max(120).optional(),
  minutes: z.number().int().min(1).max(1440).optional(),
  externalId: z.string().min(1).max(200).optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
});

export const patchActivitySchema = z
  .object({
    date: dateString.optional(),
    kcal: activityKcal.optional(),
    proteinG: activityProteinG.optional(),
    label: z.string().trim().min(1).max(120).nullable().optional(),
    minutes: z.number().int().min(1).max(1440).nullable().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });

export const postWeightSchema = z.object({
  date: dateString.optional(),
  value: z.number().finite().positive().max(2000),
  weightUnit: z.enum(['lb', 'kg', 'LB', 'KG']).optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
  override: z.boolean().optional(),
});

export const putTargetsSchema = z.object({
  effectiveFrom: dateString.optional(),
  values: z.record(codeString, targetValue).refine((o) => Object.keys(o).length > 0, {
    message: 'At least one target value is required',
  }),
});

export const patchTargetSchema = z.object({
  values: z.record(codeString, targetValue),
});

export const putWeightGoalSchema = z.object({
  effectiveFrom: dateString.optional(),
  target: z.number().finite().positive().max(2000),
  weightUnit: z.enum(['lb', 'kg', 'LB', 'KG']).optional(),
  direction: z.enum(['LOSE', 'GAIN', 'MAINTAIN']),
});

export const postNutrientSchema = z.object({
  code: codeString,
  displayName: nameString,
  unit: z.string().min(1).max(20),
  kind: z.enum(['ENERGY', 'MACRO', 'MICRO']),
  targetRule: z.enum(['MIN', 'MAX', 'RANGE']),
  sortOrder: z.number().int().min(0).max(10000).optional(),
});

export const patchNutrientSchema = z.object({
  displayName: nameString.optional(),
  unit: z.string().min(1).max(20).optional(),
  targetRule: z.enum(['MIN', 'MAX', 'RANGE']).optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
  archived: z.boolean().optional(),
});

export const postMealTypeSchema = z.object({
  code: codeString,
  displayName: nameString,
  sortOrder: z.number().int().min(0).max(10000).optional(),
});

export const patchMealTypeSchema = z.object({
  displayName: nameString.optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
  archived: z.boolean().optional(),
});

export const slugString = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be kebab-case');

export const guidelineLinks = z
  .array(
    z.object({
      label: z.string().trim().min(1).max(120),
      nutrients: z.array(codeString).max(20),
    })
  )
  .max(100);

export const postGuidelineSchema = z.object({
  slug: slugString,
  title: nameString,
  body: z.string().max(100_000).default(''),
  sortOrder: z.number().int().min(0).max(10000).optional(),
  links: guidelineLinks.optional(),
});

export const putGuidelineSchema = z.object({
  body: z.string().max(100_000),
  title: nameString.optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
});

export const patchGuidelineSchema = z.object({
  heading: z.string().trim().min(1).max(200),
  content: z.string().max(50_000),
});

export const postTokenSchema = z.object({
  name: nameString,
  scopes: z
    .array(z.enum(['nutrition:read', 'nutrition:write', 'targets:write', 'guidelines:read', 'guidelines:write']))
    .min(1)
    .optional(),
});

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(200);

export const signupSchema = z.object({
  invite: z.string().min(10).max(200),
  email: z.string().email().max(200),
  name: nameString,
  password: passwordSchema,
  timezone: z.string().max(64),
});

export function zodErrorMessage(error: z.ZodError): string {
  const first = error.issues[0];
  const path = first.path.join('.');
  return path ? `${path}: ${first.message}` : first.message;
}
