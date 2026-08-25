# Multi-stage build for the Nourish app (linux/arm64-native on Apple silicon).
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Build-time env placeholders (Zod validation runs at server start, not build).
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    NEXTAUTH_SECRET="build-placeholder-secret" \
    NEXTAUTH_URL="http://localhost:3000" \
    ADMIN_EMAIL="build@example.com" \
    ADMIN_PASSWORD="build-placeholder"
RUN npx prisma generate && npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# pg_dump for the Admin "Backup now" button (same output as the backup sidecar).
RUN apk add --no-cache postgresql16-client
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Migrations are applied by scripts/migrate.mjs (pg only, Prisma-ledger-compatible).
# The Prisma CLI is deliberately NOT in this image — its dependency tree (engines,
# @prisma/config, effect, …) cannot be shipped piecemeal, and it is not needed at
# runtime: the app uses the WASM query compiler traced into the standalone bundle.
COPY --from=builder /app/prisma/migrations ./prisma/migrations
COPY --from=builder /app/scripts ./scripts
# Next's file tracing misses the query-compiler wasm (loaded via a computed path);
# ship the complete generated client explicitly.
COPY --from=builder /app/node_modules/.prisma/client ./node_modules/.prisma/client
EXPOSE 3000
CMD ["sh", "-c", "node scripts/migrate.mjs && node scripts/bootstrap.mjs && node server.js"]
