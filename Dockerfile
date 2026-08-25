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
# Prisma CLI + migrations for `prisma migrate deploy` on start.
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/.bin/prisma ./node_modules/.bin/prisma
COPY --from=builder /app/scripts ./scripts
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node scripts/bootstrap.mjs && node server.js"]
