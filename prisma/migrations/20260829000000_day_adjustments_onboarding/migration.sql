-- v1.6: day activities (one-day energy/protein fuelling bumps) + onboarding state.
--
-- There is no per-day "Day" row in this schema — days are derived — so the recorded
-- roll-up lives in its own (userId, date) table, DayAdjustment, upserted on demand
-- and recomputed from DayActivity rows inside every activity write's transaction.

-- Individual activities: many per day, soft-deleted and revisioned like every other write.
CREATE TABLE "DayActivity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "kcal" INTEGER NOT NULL,
    "proteinG" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT,
    "minutes" INTEGER,
    "source" "Source" NOT NULL,
    "tokenId" TEXT,
    "externalId" TEXT,
    "idempotencyKey" TEXT,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DayActivity_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DayActivity_kcal_range" CHECK ("kcal" BETWEEN 0 AND 5000),
    CONSTRAINT "DayActivity_proteinG_range" CHECK ("proteinG" BETWEEN 0 AND 300),
    CONSTRAINT "DayActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "DayActivity_userId_date_idx" ON "DayActivity"("userId", "date");
CREATE UNIQUE INDEX "DayActivity_userId_idempotencyKey_key" ON "DayActivity"("userId", "idempotencyKey");
-- Partial unique for external imports (e.g. a future watch/Strava sync). Not representable
-- in schema.prisma; enforced here only.
CREATE UNIQUE INDEX "DayActivity_userId_source_externalId_key" ON "DayActivity"("userId", "source", "externalId")
  WHERE "externalId" IS NOT NULL AND "deletedAt" IS NULL;

-- Recorded roll-up per (userId, date). Derived, but stored, because a rendered past
-- day must never change. Recomputed from rows — never incremented.
CREATE TABLE "DayAdjustment" (
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "activityKcal" INTEGER NOT NULL DEFAULT 0,
    "activityProteinG" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DayAdjustment_pkey" PRIMARY KEY ("userId", "date"),
    CONSTRAINT "DayAdjustment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Onboarding + pairing signals.
ALTER TABLE "User"
  ADD COLUMN "firstMcpCallAt" TIMESTAMP(3),
  ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3),
  ADD COLUMN "onboardingSkippedAt" TIMESTAMP(3);

-- Backfill: every existing user is a set-up user. Without this, everyone on a
-- migrated deployment gets the onboarding redirect and banner (same failure class
-- as the v1.5 admin-lockout). Users whose tokens are all revoked will correctly
-- see the reconnect banner — that is the intended reconnect rule, not a bug.
UPDATE "User" SET "onboardingCompletedAt" = CURRENT_TIMESTAMP WHERE "onboardingCompletedAt" IS NULL;

-- ApiToken.lastUsedAt exists since v1.0 and is already stamped on every MCP dispatch;
-- backfill any never-stamped tokens so future stale-agent logic has a floor.
UPDATE "ApiToken" SET "lastUsedAt" = "createdAt" WHERE "lastUsedAt" IS NULL;

-- Existing users with a token that has already been used have, by definition, paired
-- an agent; stamp the pairing signal so /onboarding renders their state truthfully.
UPDATE "User" u
SET "firstMcpCallAt" = sub.first_used
FROM (
  SELECT "userId", MIN("lastUsedAt") AS first_used
  FROM "ApiToken"
  GROUP BY "userId"
) sub
WHERE u.id = sub."userId" AND u."firstMcpCallAt" IS NULL;
