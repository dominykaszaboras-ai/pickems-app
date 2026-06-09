# pickems-app — agent memory

> Persistent context for Claude Code sessions. Read this first.

## What this is

CS2 Major Pickems site. Click-to-simulate bracket, automatic HLTV
sync, multi-user accounts (Steam OpenID + email/password), per-stage
pickems with live scoring, majors.im-style pool view, live match
tracking, projected next-stage previews.

Currently tracking **IEM Cologne Major 2026**.

- GitHub: `dominykaszaboras-ai/pickems-app`
- Prod: <https://pickems-app-production.up.railway.app>
- Railway project: `stellar-wonder` (service `pickems-app` + Postgres plugin)
- Owner: `dominykaszaboras@gmail.com`

## Stack

| | |
|--|--|
| Framework | Next.js **14.2.35** (App Router, TypeScript) |
| Styling   | Tailwind |
| DB        | Prisma **5.22.0** + PostgreSQL (Railway plugin) |
| Auth      | NextAuth v5 (`5.0.0-beta.25`) — credentials + Steam OpenID |
| Scraping  | `hltv` npm package |
| Cron      | GitHub Actions (Vercel Cron NOT used — `vercel.json` was deleted) |
| Host      | Railway (Vercel docs in README are historical) |

**DO NOT bump Prisma to 7.x** — P7 forbids `datasource.url` in schema
and requires a driver adapter; not worth the migration. We tried, reverted.
Ignore the "Update available" CLI nag.

## File map

```
app/
  api/
    auth/
      [...nextauth]/route.ts     NextAuth route handler
      steam/route.ts             Step 1 of Steam OpenID dance
      steam/callback/route.ts    Step 2 of Steam OpenID dance
    signup/route.ts              Credentials signup
    sync/route.ts                Cron-protected full sync (CRON_SECRET)
    last-sync/route.ts           Polling endpoint for refresh detection
    refresh/route.ts             POST -> dispatches GH Actions workflow
    pickems/route.ts             Save user's picks
  auth/signin|signup/page.tsx
  bracket/page.tsx               Bracket + simulator + status + projection
  pickems/page.tsx               Pickem submission form
  leaderboard/page.tsx           Everyone's scores
  page.tsx, layout.tsx, providers.tsx, globals.css

components/
  Nav.tsx                        Top nav + Steam avatar + sign in/out
  BracketView.tsx                Top-level interactive view
  TournamentStatus.tsx           Per-stage status banner (status of each stage)
  UpcomingSchedule.tsx           Next ~36h of pending matches
  StageProjection.tsx            Stage 3 preview when Stage 2 is done
  SwissStage.tsx                 Single Swiss stage (Rounds | Pools toggle)
  SwissPoolView.tsx              majors.im-style W-L pool layout
  PlayoffBracket.tsx             Playoff bracket
  MatchCard.tsx                  Single match (click to simulate, HLTV ↗)
  PickSummary.tsx                User's picks with correctness per stage
  PickemsForm.tsx                Pick submission UI (locks unstarted stages)
  TeamLogo.tsx                   Team logo with name fallback
  RefreshButton.tsx              Triggers GH Actions sync from browser

lib/
  db.ts                          Prisma singleton
  types.ts                       Shared types + STAGE_LABEL + SWISS_STAGE_KINDS
  auth.ts                        NextAuth config (credentials + steam provider)
  steam.ts                       OpenID redirect/verify + public XML profile fetch
  hltv.ts                        HLTV scraper wrapper (normalizers, getMatch, getTeam)
  sync.ts                        syncTournament + syncLiveMatches + parseStageEvents
  queries.ts                     Server-side data fetching for client types
  scoring.ts                     Pure pickem scoring engine
  formatTime.ts                  Relative + absolute time formatting

prisma/
  schema.prisma                  Provider: postgresql. Team.name is unique.
  seed.ts                        Fake demo major for offline dev

scripts/
  sync.ts                        Full sync runner (npm run sync, 10min cron)
  live-sync.ts                   Live-only fast sync (npm run live-sync, 2min cron)
  inspect-teams.ts               Diagnostic: teams per stage
  inspect-pickems.ts             Diagnostic: dump saved picks with team names
  migrate-stage-kinds.ts         One-off: rename CHALLENGERS→STAGE_1 etc (run; idempotent)
  backfill-steam-profiles.ts     One-off: refresh Steam users' name+image (run; idempotent)
  backfill-stage-names.ts        One-off: rewrite Stage.name + drop stale 9029 (run if not done)

.github/workflows/
  sync.yml                       HLTV sync — every 10 minutes
  live-sync.yml                  HLTV live sync — every 2 minutes
```

## Data model (key bits)

- `Team` — `name @unique`, `hltvId Int? @unique`, `logo String?`.
  HLTV's `/results` no longer returns team IDs — **identity is keyed by name**.
- `Stage.kind` is a string (not enum): `STAGE_1` | `STAGE_2` | `STAGE_3` | `PLAYOFFS`.
  Old CSGO majors used `CHALLENGERS/LEGENDS/CHAMPIONS` — migrated.
  **Render headings from `STAGE_LABEL[kind]`**, NOT `stage.name` (the
  name column had stale strings until `backfill-stage-names.ts`).
- `Match.hltvId Int? @unique`. Status: `PENDING | LIVE | FINISHED`.
- `User.steamId String? @unique`. SteamID64.
- `Pickem` has `@@unique([userId, tournamentId])`.
- `PickemPick.kind`: `SWISS_3_0 | SWISS_0_3 | SWISS_ADVANCE | PLAYOFF_WINNER`.

## Pickems format + scoring

- Per Swiss stage: **2 × 3-0, 2 × 0-3, 6 × advance**. 3-0/0-3/ADV are
  mutually exclusive per team.
- Playoffs: one team per round (QF=1, SF=2, Final=3, Champion=4).
- **1 point per correct pick, full stop.** (Was 1/4/4 historically.)
- Correctness rules (see `lib/scoring.ts`):
  - `SWISS_3_0` is wrong the moment that team's `losses >= 1` (a 3-0
    finish becomes impossible). Right only when `outcome === QUALIFIED_3_0`.
  - `SWISS_0_3` symmetric: wrong as soon as `wins >= 1`.
  - `SWISS_ADVANCE` right only if `status === ADVANCED && losses >= 1`
    (3-1 / 3-2). A 3-0 team does NOT satisfy ADV — it only satisfies 3-0.

## HLTV event IDs (per-major data)

Cologne 2026 splits each Major stage into its own HLTV event:

| Stage | Event ID | Notes |
|---|---|---|
| Umbrella (teams, dates, name) | `8301` | The /events/8301/... URL on HLTV |
| Stage 1 | `9028` | Concluded |
| Stage 2 | `9029` | Concluded |
| Stage 3 | **TBD** | Add to `HLTV_STAGE_EVENTS` when published |
| Playoffs | **TBD** | Add to `HLTV_STAGE_EVENTS` when published |

`HLTV_EVENT_ID` env var holds the umbrella. `HLTV_STAGE_EVENTS` is a
comma-separated `KIND:ID` map parsed by `lib/sync.ts:parseStageEvents`.

## Env vars (Railway service `pickems-app`)

| Var | Used for |
|---|---|
| `DATABASE_URL` | Postgres plugin reference (`${{Postgres.DATABASE_URL}}`) |
| `AUTH_SECRET` | NextAuth JWT signing — also used as HMAC key in `lib/steam.ts` |
| `AUTH_URL` | `https://pickems-app-production.up.railway.app` |
| `CRON_SECRET` | Protects `/api/sync` (Bearer auth) |
| `GITHUB_TOKEN` | Server uses this to dispatch GH Actions sync workflow on Refresh button click |
| `HLTV_EVENT_ID` | `8301` (umbrella) |
| `HLTV_STAGE_EVENTS` | `STAGE_1:9028,STAGE_2:9029` (extend when Stage 3 / Playoffs land) |

GitHub repo secrets (for workflows):
- `DATABASE_URL` (public Postgres proxy URL, `acela.proxy.rlwy.net:46540`)
- `HLTV_EVENT_ID`
- `HLTV_STAGE_EVENTS`

**STEAM_API_KEY is intentionally NOT set.** Per security preference,
we don't run a server-wide Steam Web API key. Steam profile data
comes from the public community XML endpoint (no key needed). Steam
pickem auto-import via `ICSGOTournaments_730` is implemented in
git history (commit `754c47c`) but reverted (commit `076c1cb`) for
the same reason. Per-user-key model is the unbuilt compromise if
the user changes their mind.

## Critical gotchas (don't relearn these)

1. **HLTV /results returns no team IDs** — only `team1.name` + `team1.logo`.
   Don't add a normalizer that expects `team1.id`. Identify by name. `lib/sync.ts:ensureTeamByName` is the chokepoint.
2. **HLTV blocks Railway datacenter IPs via Cloudflare** ("Access denied"
   500). Syncing from Railway always fails. Use GH Actions (Azure IPs)
   for crons. Manual local syncs work from residential IPs.
3. **`HLTV.getEvent` is the most-blocked endpoint**. `lib/hltv.ts:fetchEventSnapshot` wraps it in `safe()` — keep it that way so one
   blocked call doesn't abort the full sync.
4. **Stage names in DB diverged from new naming**. Always read display
   headings from `STAGE_LABEL[stage.kind]`. `lib/sync.ts` now updates
   `name` on upsert, so future syncs self-heal.
5. **Pickems API Zod enum** must list all four StageKind values. We
   forgot once after the rename and every save returned "Invalid input".
6. **NextAuth v5 + Credentials provider**: type the `providers` array
   explicitly (`NextAuthConfig["providers"]`) or TS narrows it and rejects
   pushing the GitHub OAuth provider.
7. **Railway build needs DB only at runtime.** Build = `next build`;
   `prisma db push` lives in the start command. Plugin env vars aren't
   available during Nixpacks build.
8. **`npm ci` trips EBUSY on Railway** because Nixpacks mounts
   `node_modules/.cache` as a build cache volume. `railway.json` uses
   `npm install` to avoid the wipe.
9. **Steam OpenID flow**: `/api/auth/steam` builds the redirect, callback
   verifies via `check_authentication`, HMAC-signs the SteamID with
   `AUTH_SECRET`, then calls `signIn("steam", { token })`. The `steam`
   credentials provider only accepts a valid HMAC, so browser POSTs
   without the signature are rejected. Profile name + avatar from
   `steamcommunity.com/profiles/<id>?xml=1` (no key needed).
10. **Session JWT is cached** — `lib/auth.ts:session` callback re-reads
    `name` and `image` from DB on every check so existing JWTs pick up
    DB updates without forcing sign-out + sign-in.

## Cron architecture

| Workflow | Cadence | What it does |
|---|---|---|
| `sync.yml` | every 10 min | Full sync: umbrella event + per-stage events. Discovers new matches, teams, schedule. |
| `live-sync.yml` | every 2 min | `syncLiveMatches()` — only touches matches currently LIVE or PENDING within ±30 min. Updates scoreA/scoreB/status/winner via `HLTV.getMatch(id)`. |

Browser auto-refresh on `/bracket`: if any match in DOM has `status:"LIVE"`,
BracketView polls `/api/last-sync` every 30s and calls `router.refresh()`
when the `lastSyncedAt` timestamp advances. End-to-end latency from
"map ends on HLTV" to "score updates on screen" ≤ ~2.5 min.

## Common commands

```bash
# Local dev
npm run dev

# Local sync against prod DB (residential IP bypasses Cloudflare)
DATABASE_URL="postgresql://postgres:dfjeohBeOHHKLTYjwbIHKTJKDEVgCnwl@acela.proxy.rlwy.net:46540/railway" \
  HLTV_EVENT_ID=8301 HLTV_STAGE_EVENTS="STAGE_1:9028,STAGE_2:9029" \
  npx tsx scripts/sync.ts

# Quick live-only update
DATABASE_URL="..." npx tsx scripts/live-sync.ts

# Diagnostics
DATABASE_URL="..." npx tsx scripts/inspect-teams.ts
DATABASE_URL="..." npx tsx scripts/inspect-pickems.ts

# Schema migration (regenerate client + push to DB)
npx prisma generate && DATABASE_URL="..." npx prisma db push --accept-data-loss

# Trigger GH Actions sync now
gh workflow run "HLTV sync" --repo dominykaszaboras-ai/pickems-app

# Railway env edits
railway link --project stellar-wonder --service pickems-app --environment production
railway variables --set "KEY=value"
railway variables --kv | grep KEY

# Postgres public proxy (use locally; internal URL only works inside Railway)
postgresql://postgres:dfjeohBeOHHKLTYjwbIHKTJKDEVgCnwl@acela.proxy.rlwy.net:46540/railway
```

## Workflow conventions

- **Commits**: descriptive subject + body explaining the *why*.
  Footer: `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`
- **Branches**: work on `main` directly; deploy is GH push → Railway auto-build.
- **DB migrations**: edit `prisma/schema.prisma`, push with `prisma db push`
  (no migrations folder — keep using `db push` for this scale).
- **Adding a stage event ID**: update both Railway env (`HLTV_STAGE_EVENTS`)
  AND the GitHub repo secret of the same name (the workflow uses the secret).
- **Use `STAGE_LABEL[kind]`** for any stage heading in UI. Never `stage.name`.
- **Use `ensureTeamByName`** for teams from HLTV. Never `ensureTeam(hltvId)`.

## Active todos / followups

- [ ] **Wait for Stage 3 / Playoffs HLTV event IDs**, then add to
  `HLTV_STAGE_EVENTS` on Railway + GH secret. Format:
  `STAGE_1:9028,STAGE_2:9029,STAGE_3:<id>,PLAYOFFS:<id>`.
- [ ] (Optional) Run `scripts/backfill-stage-names.ts` against prod
  to rewrite the stale "Challengers Stage" / "Legends Stage" /
  "Champions Stage" strings in `Stage.name` and drop the leftover
  9029 tournament row. UI already reads from `STAGE_LABEL[kind]`, so
  this is just DB tidiness.
- [ ] (Optional, if user changes mind) Re-add Steam pickem auto-import
  via per-user Steam API key model (each user pastes their own key + auth
  code, no shared server secret).
- [ ] (Cosmetic) Add a "Pool view as default for concluded stages"
  preference — right now Rounds is always the default.

## Things to NOT do

- Don't bump Prisma to 7.x.
- Don't add a server-wide `STEAM_API_KEY`. (User explicitly declined.)
- Don't use `npm ci` in Railway builds (EBUSY). `npm install` is correct here.
- Don't rely on `stage.name` for headings.
- Don't expect HLTV `/results` to include team IDs.
- Don't sync from Railway runtime — only GH Actions runners get through Cloudflare.
- Don't trust `inferStageKind` heuristic alone — per-stage event IDs are
  the source of truth via `fetchStageMatches(eventId, stageKind)`.
