import { Client } from 'pg';
import bcrypt from 'bcryptjs';

/** Reset the E2E database to a fresh state with only the bootstrapped admin. */
export default async function globalSetup() {
  const connectionString =
    process.env.E2E_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgresql://postgres@127.0.0.1:5433/nourish_e2e';
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`
      TRUNCATE TABLE "EntryRevision", "AuthEvent", "GuidelineRevision", "GuidelineSection",
        "MealItemNutrient", "MealItem", "Meal", "Weight", "Target", "WeightGoal",
        "Nutrient", "MealType", "ApiToken", "Session", "Invite", "User" CASCADE
    `);
    const email = (process.env.ADMIN_EMAIL ?? 'admin@example.com').toLowerCase();
    const password = process.env.ADMIN_PASSWORD ?? 'admin-password';
    const hash = await bcrypt.hash(password, 4);
    await client.query(
      `INSERT INTO "User" (id, email, "passwordHash", name, role, "mustChangePassword")
       VALUES ('e2e-admin', $1, $2, 'Admin', 'ADMIN', true)`,
      [email, hash]
    );
  } finally {
    await client.end();
  }
}
