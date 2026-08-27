# Nourish

Self-hosted, multi-user nutrition tracker. **Agents do the data management; the UI is for looking, not typing.** Next.js 14 (App Router) · Prisma 6 / PostgreSQL · NextAuth credentials · React Query · Tailwind, with a stdio MCP server (`mcp/`) that wraps the REST API for Claude and other agents.

- A **meal is a slot** unique per `(user, date, meal type)` holding items; item nutrition is per single unit and totals are always `perUnit × quantity` — never send duplicate items, use `quantity`.
- **Targets are append-only and effective-dated** — changing a target never rewrites past checkmarks or your streak.
- Day success = calories at or under target **and** protein at or over target. Weeks (Mon–Sun) also need every active micronutrient's cumulative intake to reach `dailyTarget × 7`.
- The **admin can never see anyone's nutrition data** — invite yourself as a normal user for tracking.
- Every create/update/delete is recorded as an `EntryRevision`; the Log tab shows the full audit trail with before/after diffs. User edits pin entries; agents need an explicit (recorded) override to change them.

## Deploy on a Mac mini (Apple silicon) with Docker

Reached over VPN only (Tailscale recommended: stable `100.x` address / `nourish.<tailnet>.ts.net` name, no port forwarding). Images build natively for `linux/arm64`.

### First-time setup

1. Install Docker Desktop (enable *Start Docker Desktop when you sign in*) or OrbStack. Install Tailscale and sign in.
2. `git clone <repo> ~/nourish && cd ~/nourish`
3. `cp .env.example .env` and fill in the values (generators are in the comments). Compose v2.24+ interpolates `${POSTGRES_PASSWORD}` inside `.env`.
4. `docker compose up -d --build` — the first build takes a few minutes on the mini.
5. Visit `NEXTAUTH_URL`; sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`, change the password when prompted.
6. Admin → Invites → create an invite for yourself as a normal user (the admin cannot hold nutrition data), sign up, then Settings → API tokens → create **"Claude desktop"** — the dialog shows the token once, along with a ready-to-paste **connector URL**.
7. Connect an agent — see the next section. No installs are required on anyone's machine.

## Connecting agents (no installs)

The app serves MCP itself over Streamable HTTP at **`/api/mcp`**. Setup is one URL per person; adding a user = admin invite → they sign up → they mint their own token in Settings. Nothing to `npm install`, ever.

**From a phone or claude.ai (custom connector).** Claude's connector flow requires an OAuth handshake, so Nourish ships a minimal OAuth 2.1 layer (discovery, dynamic client registration, and a consent page where you paste your API token once; the issued credential *is* that token, scopes and all). Setup: in the Claude app, Settings → Connectors → *Add custom connector* → paste the connector URL from Nourish Settings (`https://<host>/api/mcp`) → when the "Connect to Nourish" page opens, paste your `ntk_…` token → Allow. Revoking the token in Settings disconnects the client.

One caveat: claude.ai connectors dial in from Anthropic's cloud, not from your device, so a VPN-only server is unreachable to them. Publish the MCP path *and the OAuth paths* with Tailscale Funnel — the rest of the app stays tailnet-only:

```sh
tailscale funnel --bg --set-path /api/mcp      http://127.0.0.1:3000/api/mcp
tailscale funnel --bg --set-path /oauth        http://127.0.0.1:3000/oauth
tailscale funnel --bg --set-path /.well-known  http://127.0.0.1:3000/.well-known
```

Set `MCP_PUBLIC_URL=https://<mini>.<tailnet>.ts.net/api/mcp` in `.env` so Settings hands out the right URL and the OAuth metadata advertises the public origin. Check with `tailscale funnel status`; undo with `tailscale funnel reset`.

**From Claude Code / any MCP client that can set headers** (on the tailnet, no Funnel needed):

```sh
claude mcp add --transport http nourish http://nourish.<tailnet>.ts.net:3000/api/mcp \
  --header "Authorization: Bearer ntk_..."
```

**Scopes instead of flags.** Tool visibility follows the token: a token without write scopes only sees (and can only call) read tools. Mint a read-only token in Settings for a look-but-don't-touch agent.

**stdio fallback.** The original local wrapper still exists for fully offline setups: `cd mcp && npm install && npm run build`, then register `node mcp/dist/index.js --allow-writes` with `NOURISH_URL` / `NOURISH_TOKEN` env vars.

### Day-2 operations

- **Update:** `git pull && docker compose up -d --build` (migrations run on start).
- **Logs:** `docker compose logs -f app`.
- **Backups:** the `backup` sidecar runs `pg_dump` daily into `./backups` with 14-day retention; Admin → "Backup now" produces an identical file on demand.
- **Restore:** `docker compose stop app && sh scripts/restore.sh backups/<file>.sql.gz && docker compose start app`.
- **Reboot survival:** `restart: unless-stopped` + Docker Desktop at login brings the stack back after a power cut.
- **macOS sleep:** System Settings → Energy → *Prevent automatic sleeping when the display is off* and *Start up automatically after a power failure*, or the API will be unreachable overnight.
- **Time zones:** the container runs UTC; all day math uses each user's stored timezone, so the host clock zone is irrelevant.

## Deploying publicly (Vercel)

The same codebase deploys to Vercel unchanged — the Docker path above stays the self-host option. Everything service-shaped is opt-in by env var and degrades gracefully when absent:

- **Upstash Redis** (`UPSTASH_REDIS_REST_URL/TOKEN`) — shared rate limiting + login backoff. Optional on the single-process Docker deploy; **required on Vercel** (the `vercel-build` preflight fails the build without it, since per-instance memory can't rate-limit serverless).
- **Resend** (`RESEND_API_KEY` + `EMAIL_FROM`) — email verification on signup, self-serve password reset (`/forgot`), email change confirmation, invite delivery, and security notices (new token, new agent connection, password changed). Without it, signups auto-verify (invites already pin identity), resets go through the admin, and notices log to the console.
- **PostHog** (`POSTHOG_KEY`, optional `POSTHOG_HOST`) — server-side events only (names + counts; never nutrition data). Off when unset.
- **Database URLs**: point `DATABASE_URL` at the pooled (PgBouncer) connection and `MIGRATE_DATABASE_URL` at the direct one; `vercel-build` runs migrations before the build.

Security posture (always on, no config): CSP/HSTS/frame-deny/nosniff headers on every response, a cross-origin check on all cookie-authenticated mutations, and an auth audit trail (Admin → Auth log) covering signup, verification, password and email changes, tokens, OAuth grants, and admin actions.

## Dev loop

```sh
cp .env.development .env.local
docker compose up -d db          # or any local Postgres matching DATABASE_URL
npx prisma migrate deploy
npm install
npm run dev                      # http://localhost:3000
npm run db:seed                  # demo user: demo@example.com / demo-password
```

No external services required — rate limiting falls back to in-memory without Upstash.

### Tests

```sh
npm run lint && npm run typecheck
npm test          # unit + API contract tests (needs TEST_DATABASE_URL, see __tests__/integration/setup.ts)
npm run test:e2e  # Playwright, drives the full invite → token → agent-conflict flow
```

## API in one breath

Bearer tokens (`ntk_…`, SHA-256 at rest, revoke-only) are bound to one user and scoped (`nutrition:read/write`, `targets:write`, `guidelines:read/write`). Key routes: `POST /api/meals` (slot upsert + items, idempotency keys, `409` on duplicate names unless `onConflict=replace|increment`), `GET /api/days?from&to`, `POST/GET /api/weights`, `GET/PUT /api/targets` (+ `PATCH /api/targets/{id}` session-only "correct a past target"), `GET/PUT /api/weight-goal`, `GET/POST/PATCH /api/nutrients`, `/api/meal-types`, `GET /api/summary?range=7d|30d|90d`, `GET /api/suggestions`, `GET /api/activity`, `/api/guidelines[...]` (global, revisioned, revertable), `GET /api/export?format=json|csv`, `POST /api/import` (fresh accounts only), `/api/admin/*` (session + ADMIN; never returns nutrition data), `GET /api/health`.

Rate limits: auth 10/min/IP · agent writes 120/min/token · reads 600/min/token · admin 60/min. Login backoff: 5 failures → 15-minute lockout.
