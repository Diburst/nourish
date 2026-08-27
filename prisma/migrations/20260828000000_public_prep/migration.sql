-- Public-exposure prep: audit metadata, email verification, email-flow tokens.

ALTER TABLE "AuthEvent" ADD COLUMN "meta" JSONB;

ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
-- Every account that exists before email verification shipped is grandfathered in:
-- they were created through admin-issued invites, which already pinned identity.
UPDATE "User" SET "emailVerifiedAt" = CURRENT_TIMESTAMP;

CREATE TABLE "EmailToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "newEmail" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailToken_tokenHash_key" ON "EmailToken"("tokenHash");
CREATE INDEX "EmailToken_userId_kind_idx" ON "EmailToken"("userId", "kind");

ALTER TABLE "EmailToken" ADD CONSTRAINT "EmailToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
