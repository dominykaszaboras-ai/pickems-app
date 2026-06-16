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
| Auth      | NextAuth v5 (`5.0.0-beta.31`) — credentials + Steam OpenID |
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
      steam/link/route.ts        Step 1 of Steam LINK flow (session-gated)
      steam/link/callback/route.ts Step 2 of Steam LINK flow — updates existing user
      steam/unlink/route.ts      POST: detach Steam from current user (needs email+password fallback)
    pickems/sync-steam/route.ts  POST: paste Major Auth Code -> Valve API -> raw JSON saved on User
    signup/route.ts              Credentials signup
    sync/route.ts                Cron-protected full sync (CRON_SECRET)
    last-sync/route.ts           Polling endpoint for refresh detection
    refresh/route.ts             POST -> dispatches GH Actions workflow
    pickems/route.ts             Save user's picks
    friends/route.ts             GET accepted friends + pending in/out
    friends/request/route.ts     POST send friend request
    friends/respond/route.ts     POST accept/decline incoming request
    friends/[id]/route.ts        DELETE unfriend / cancel outgoing request
    users/search/route.ts        GET search users by name (signed-in only, 3-char min)
  auth/signin|signup/page.tsx
  bracket/page.tsx               Bracket + simulator + status + projection
  pickems/page.tsx               Pickem submission form
  leaderboard/page.tsx           Everyone's scores + Friends-only toggle (?friends=1)
  friends/page.tsx               Friend management (search, pending, accepted)
  users/[id]/page.tsx            Public profile: score + per-stage picks (stage-locked)
  icon.tsx                       Trophy 🏆 favicon (Next.js App Router ImageResponse)
  page.tsx, layout.tsx, providers.tsx, globals.css

components/
  Nav.tsx                        Top nav; avatar click → dropdown (My profile/Friends/Sign out)
  BracketView.tsx                Top-level interactive view (stages in descending order)
  TournamentStatus.tsx           Per-stage status banner (Swiss-aware concluded check)
  UpcomingSchedule.tsx           Next ~36h of pending matches (TW/YT watch buttons)
  LiveStreamEmbed.tsx            Twitch iframe at top of /bracket when ANY match is LIVE
  StageProjection.tsx            Stage 3 preview when Stage 2 is done
  SwissStage.tsx                 Single Swiss stage (Rounds | Pools toggle, hidden by default)
  SwissPoolView.tsx              majors.im-style W-L pool layout
  PlayoffBracket.tsx             Playoff bracket
  MatchCard.tsx                  Single match (click to simulate, HLTV ↗, TW/YT)
  PickSummary.tsx                User's picks with correctness per stage
  PickemsForm.tsx                Pick submission UI (locks unstarted stages)
  TeamLogo.tsx                   Team logo with name fallback
  RefreshButton.tsx              Triggers GH Actions sync; idle label = "Synced Xs ago"
  FriendsView.tsx                Client component for /friends (search + list + actions)
  FriendButton.tsx               Add/accept/decline/unfriend button on /users/[id]
  SteamLinkPanel.tsx             Link/Unlink Steam panel shown on the viewer's own profile
  SteamSyncCard.tsx              Paste Major Auth Code on /pickems (only when user has steamId)

lib/
  db.ts                          Prisma singleton
  types.ts                       Shared types + STAGE_LABEL + SWISS_STAGE_KINDS
  auth.ts                        NextAuth config (credentials + steam provider, login rate-limit)
  steam.ts                       OpenID redirect/verify + return_to host check + signed-fields check
  steamPickems.ts                ICSGOTournaments_730 wrapper: layout + predictions + raw-shape extractor
  hltv.ts                        HLTV scraper wrapper (normalizers, getMatch, getTeam)
  liquipedia.ts                  MediaWiki API client: schedule + broadcast channels + team-name normalizer
  streams.ts                     resolveWatchLinks() (per-match override → tournament default) + twitchEmbedSrc()
  rateLimit.ts                   In-memory limiter + clientIp + isSameOrigin (CSRF gate)
  sync.ts                        syncTournament + syncLiveMatches + parseStageEvents + ghost adoption
  queries.ts                     Server-side data fetching for client types
  scoring.ts                     Pure pickem scoring engine
  formatTime.ts                  Relative + absolute time formatting; exports formatAgo()
  friends.ts                     loadFriendGraph / statusOf / loadUserSummaries (server helpers)

prisma/
  schema.prisma                  Provider: postgresql. Team.name is unique.
  seed.ts                        Fake demo major for offline dev
  manual-sql/
    friendship_pair_unique.sql   Unordered-pair unique index on Friendship (already applied to prod).
                                 Run via: DATABASE_URL=... npx prisma db execute --schema prisma/schema.prisma \
                                   --file prisma/manual-sql/friendship_pair_unique.sql

scripts/
  sync.ts                        Full sync runner (npm run sync, 10min cron)
  live-sync.ts                   Live-only fast sync (npm run live-sync, 2min cron)
  sync-schedule.ts               Daily Liquipedia schedule + broadcast sync (npm run sync-schedule)
  probe-event.ts                 Diagnostic: HLTV event ID discovery (ids/find/scan/stage modes)
  probe-liquipedia.ts            Diagnostic: dry-run Liquipedia parser (parse/raw/snippet modes)
  inspect-teams.ts               Diagnostic: teams per stage
  inspect-pickems.ts             Diagnostic: dump saved picks with team names
  migrate-stage-kinds.ts         One-off: rename CHALLENGERS→STAGE_1 etc (run; idempotent)
  backfill-steam-profiles.ts     One-off: refresh Steam users' name+image (run; idempotent)
  backfill-stage-names.ts        One-off: rewrite Stage.name + drop stale 9029 (run if not done)

.github/workflows/
  sync.yml                       HLTV sync — every 10 minutes
  live-sync.yml                  HLTV live sync — every 2 minutes
  sync-schedule.yml              Liquipedia schedule + broadcasts — daily @ 05:30 UTC
```

## Data model (key bits)

- `Team` — `name @unique`, `hltvId Int? @unique`, `logo String?`.
  HLTV's `/results` no longer returns team IDs — **identity is keyed by name**.
- `Stage.kind` is a string (not enum): `STAGE_1` | `STAGE_2` | `STAGE_3` | `PLAYOFFS`.
  Old CSGO majors used `CHALLENGERS/LEGENDS/CHAMPIONS` — migrated.
  **Render headings from `STAGE_LABEL[kind]`**, NOT `stage.name` (the
  name column had stale strings until `backfill-stage-names.ts`).
- `Tournament` — adds `twitchChannel String?` + `youtubeChannel String?` (raw handles, e.g. "ESLCS"). Daily Liquipedia sync writes them; UI builds `twitch.tv/<x>` + `youtube.com/@<x>` at render time.
- `Match.hltvId Int? @unique`. Status: `PENDING | LIVE | FINISHED`. Liquipedia-sourced PENDING rows have `hltvId=null` until adoption.
- `Match.twitchUrl / youtubeUrl String?` — per-match stream override; usually null, renderer falls back to the tournament default.
- `User.steamId String? @unique`. SteamID64.
- `Pickem` has `@@unique([userId, tournamentId])`.
- `PickemPick.kind`: `SWISS_3_0 | SWISS_0_3 | SWISS_ADVANCE | PLAYOFF_WINNER`.
- `Friendship` — in-app friend graph (no Steam API dependency). `status`: `PENDING | ACCEPTED`. Decline = hard delete so the pair can re-request later. Two unique constraints: Prisma `@@unique([requesterId, receiverId])` (same-direction) + a manual unordered-pair index (`LEAST/GREATEST`) applied to prod via `prisma/manual-sql/friendship_pair_unique.sql` to prevent simultaneous mutual adds producing two PENDING rows. Cascade-deletes when either user is deleted.

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

Cologne 2026 splits SOME stages into their own HLTV event; Stage 3 lives on the umbrella:

| Stage | Event ID | Notes |
|---|---|---|
| Umbrella (teams, dates, name) | `8301` | The /events/8301/... URL on HLTV |
| Stage 1 | `9028` | Concluded |
| Stage 2 | `9029` | Concluded |
| Stage 3 | `8301` | **No separate sub-event — matches live directly on the umbrella.** `fetchStageMatches(8301, STAGE_3)` filters by event.id; Stage 1/2 matches live under 9028/9029 so there's no overlap. |
| Playoffs | `9029` (per 2026-06-16) | **Same HLTV event id as Stage 2.** Stage 2 is concluded so practical overlap is low, but be aware `fetchStageMatches` will see both stages' matches via id 9029 and rely on the `stageKind` arg to attribute them correctly. If we see double-counts, switch playoffs to its own id (probe with `scripts/probe-event.ts`). |

`HLTV_EVENT_ID` env var holds the umbrella. `HLTV_STAGE_EVENTS` is a
comma-separated `KIND:ID` map parsed by `lib/sync.ts:parseStageEvents`.

**Discovery tool**: when a new stage's HLTV event ID is unknown, use
`scripts/probe-event.ts` (modes: `ids`, `find`, `scan`, `stage`) to
verify before wiring it into env vars.

## Env vars (Railway service `pickems-app`)

| Var | Used for |
|---|---|
| `DATABASE_URL` | Postgres plugin reference (`${{Postgres.DATABASE_URL}}`) |
| `AUTH_SECRET` | NextAuth JWT signing — also used as HMAC key in `lib/steam.ts` |
| `AUTH_URL` | `https://pickems-app-production.up.railway.app` |
| `CRON_SECRET` | Protects `/api/sync` (Bearer auth) |
| `GITHUB_TOKEN` | Server uses this to dispatch GH Actions sync workflow on Refresh button click |
| `HLTV_EVENT_ID` | `8301` (umbrella) |
| `HLTV_STAGE_EVENTS` | `STAGE_1:9028,STAGE_2:9029,STAGE_3:8301` (extend with `PLAYOFFS:<id>` when announced) |

GitHub repo secrets (for workflows):
- `DATABASE_URL` (public Postgres proxy URL, `acela.proxy.rlwy.net:46540`)
- `HLTV_EVENT_ID`
- `HLTV_STAGE_EVENTS`

**STEAM_API_KEY is now set** (as of 2026-06-16) to enable Major pickem
auto-import via `ICSGOTournaments_730/GetTournamentPredictions`. The
key is owned by `dominykaszaboras@gmail.com`'s Steam account — leak
impact is bounded (Valve will revoke it, app loses Steam features
until rotated). **Key lives in Railway env only — never commit it.**
Profile data still comes from the public community XML endpoint;
the key is only used for the per-user pickem import (gated by the
user's per-Major "Major Auth Code").

**Key-leak defences** (per Oracle review):
- `lib/steamPickems.ts:scrubKey()` strips the key out of every Valve
  error body before it crosses the trust boundary. Errors thrown to
  the route are generic ("Steam upstream error") with the scrubbed
  detail logged server-side only.
- Process-wide outbound budget: 60 calls/min + 20k/day across all
  users. Enforced in `consumeOutboundBudget()` before every outbound
  call. Sits ON TOP of the per-(user, IP) 6/min route limiter.
- Layout cached in-process for 1h per eventId so a single Major
  doesn't burn more outbound calls than necessary.
- `STEAM_PICKEM_EVENT_ID` is server-pinned; the API route does NOT
  accept a client-supplied override (was an event-enumeration vector).

## Critical gotchas (don't relearn these)

0. **`HLTV.getMatches()` returns empty arrays silently** when Cloudflare
   serves a JS challenge page — the `hltv` package parses the challenge
   HTML as `[]` instead of throwing. That's why the upcoming match schedule
   never showed up from HLTV alone. Liquipedia's MediaWiki `parse` API is
   the workaround — see `Data source split` below.


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

## Data source split (HLTV vs Liquipedia)

We use both — neither alone is enough. Stick to this split when changing
syncs so we don't lose properties of one for the other.

| What | Source | Why |
|------|--------|-----|
| Match results (final scores, winners) | HLTV | Updated within minutes of a map ending; Liquipedia lags 10–30 min. |
| Live match state (LIVE flag, in-progress score) | HLTV `getMatch` | The fast 2-min cadence depends on a structured endpoint Liquipedia doesn't have. |
| Upcoming match schedule | **Liquipedia** | HLTV's `getMatches()` routinely returns empty for our Major (Cloudflare challenge parsed as `[]`); Liquipedia's stage pages publish reliable `data-timestamp` epochs. |
| Teams / general tournament metadata | HLTV (umbrella event) | Sufficient and already wired. |
| Main broadcast channels (Twitch / YouTube) | **Liquipedia** umbrella event | Lives in the external-links sidebar; HLTV exposes it only on individual match pages we can't reach. |
| Per-match stream override | Liquipedia (best-effort) | Rarely populated; renderer falls back to tournament default. |

If the Liquipedia tournament moves (new Major), update
`COLOGNE_2026_LIQUIPEDIA` and `COLOGNE_2026_LIQUIPEDIA_UMBRELLA` in
`lib/liquipedia.ts` alongside the HLTV event IDs.

## Cron architecture

| Workflow | Cadence | What it does |
|---|---|---|
| `sync.yml` | every 10 min | Full sync: umbrella event + per-stage events. Discovers new matches, teams, schedule. Also performs **ghost adoption** — claims Liquipedia-sourced PENDING rows by stamping the now-known `hltvId` on them. |
| `live-sync.yml` | every 2 min | `syncLiveMatches()` — only touches matches currently LIVE or PENDING within ±30 min. Updates scoreA/scoreB/status/winner via `HLTV.getMatch(id)`. |
| `sync-schedule.yml` | daily @ 05:30 UTC | Pulls per-stage match schedules + main broadcast channels from Liquipedia. Writes PENDING rows with `hltvId=null` that the regular sync adopts later. |

Browser auto-refresh on `/bracket`: if any match in DOM has `status:"LIVE"`,
BracketView polls `/api/last-sync` every 30s and calls `router.refresh()`
when the `lastSyncedAt` timestamp advances. End-to-end latency from
"map ends on HLTV" to "score updates on screen" ≤ ~2.5 min.

## Common commands

```bash
# Local dev
npm run dev

# Local sync against prod DB (residential IP bypasses Cloudflare)
DATABASE_URL="$(railway variables --kv | grep '^DATABASE_PUBLIC_URL=' | cut -d= -f2-)" \
  HLTV_EVENT_ID=8301 HLTV_STAGE_EVENTS="STAGE_1:9028,STAGE_2:9029" \
  npx tsx scripts/sync.ts

# Quick live-only update
DATABASE_URL="..." npx tsx scripts/live-sync.ts

# Daily-style Liquipedia schedule + broadcast sync
DATABASE_URL="..." HLTV_EVENT_ID=8301 npx tsx scripts/sync-schedule.ts

# Diagnostics — HLTV event ID hunt (no DB)
npx tsx scripts/probe-event.ts ids 8301 9028 9029
npx tsx scripts/probe-event.ts scan 9100 9500 "cologne"
npx tsx scripts/probe-event.ts stage 8301 STAGE_3

# Diagnostics — Liquipedia parser (no DB)
npx tsx scripts/probe-liquipedia.ts
npx tsx scripts/probe-liquipedia.ts snippet

# Diagnostics — DB inspection
DATABASE_URL="..." npx tsx scripts/inspect-teams.ts
DATABASE_URL="..." npx tsx scripts/inspect-pickems.ts

# Schema migration (regenerate client + push to DB)
npx prisma generate && DATABASE_URL="..." npx prisma db push --accept-data-loss

# Trigger GH Actions syncs now
gh workflow run "HLTV sync" --repo dominykaszaboras-ai/pickems-app
gh workflow run "Liquipedia schedule sync" --repo dominykaszaboras-ai/pickems-app

# Railway env edits
railway link --project stellar-wonder --service pickems-app --environment production
railway variables --set "KEY=value"
railway variables --kv | grep KEY

# Postgres public proxy (use locally; internal URL only works inside Railway)
# Pull the live URL from Railway instead of hardcoding it here:
#   railway variables --kv | grep '^DATABASE_PUBLIC_URL='
# Host/port: acela.proxy.rlwy.net:46540 (password rotates — don't paste it into docs)
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

- [x] **Playoffs HLTV event ID set to `9029`** (2026-06-16). GH secret `HLTV_STAGE_EVENTS` updated to `STAGE_1:9028,STAGE_2:9029,STAGE_3:8301,PLAYOFFS:9029`. Same id as Stage 2 — Stage 2 is concluded so practical overlap should be nil, but watch for double-attributed matches in the next sync. Railway env not yet mirrored (CLI auth expired during this session).
- [ ] **Owner: update `HLTV_STAGE_EVENTS` on Railway** to `STAGE_1:9028,STAGE_2:9029,STAGE_3:8301`. Cron runs from GH Actions so syncs work today; the Railway env only matters for `/api/sync` direct calls (Refresh button still dispatches GH).
- [x] **Rotated Postgres password** (2026-06-14). Regenerated `POSTGRES_PASSWORD` via Railway's variable generator → Railway re-ALTERed the DB user + rebuilt templated `DATABASE_URL` / `DATABASE_PUBLIC_URL` → `pickems-app` redeployed via the `${{Postgres.DATABASE_URL}}` reference. GH Actions `DATABASE_URL` secret updated via `gh secret set`. All three sync workflows verified green afterward.
- [x] **In-app friend system** (2026-06-15). Search-and-add friends by display name (no Steam API). `/friends` management page, `/users/[id]` profile with per-stage pick lock, leaderboard Friends-only toggle, avatar dropdown in Nav. See Data model + Security posture sections for full detail.
- [x] **Steam linking on existing accounts** (2026-06-16). New `/api/auth/steam/link` + `/api/auth/steam/link/callback` routes let a signed-in email user attach a SteamID without creating a fresh row. `/api/auth/steam/unlink` POST detaches, but refuses if the user has no email+passwordHash fallback (would lock themselves out). UI lives in `SteamLinkPanel` on the viewer's own profile page. Conflict cases handled: already-yours, already-linked-to-current-user, SteamID owned by another user (P2002).
- [x] **Pickem auto-import via Steam Web API** (2026-06-16). User pastes their per-Major "Major Auth Code" (`steamidkey`) from help.steampowered.com on `/pickems` (only visible when they have a linked SteamID). `/api/pickems/sync-steam` calls `ICSGOTournaments_730/GetTournamentLayout/v1` + `GetTournamentPredictions/v1`, stores raw JSON on `User.steamPickemRaw` (+ code on `steamPickemCode`), returns prediction count. **Mapping Valve's predictions -> our PickemPick rows is still a follow-up** — Valve's section/group/pickid numbering is undocumented and per-Major; we want to see one real prod response before committing to a mapping. Requires `STEAM_API_KEY` (set on Railway) and `STEAM_PICKEM_EVENT_ID` (Valve's per-Major event id, NOT HLTV's).
- [ ] (Optional) Run `scripts/backfill-stage-names.ts` against prod
  to rewrite the stale "Challengers Stage" / "Legends Stage" /
  "Champions Stage" strings in `Stage.name` and drop the leftover
  9029 tournament row. UI already reads from `STAGE_LABEL[kind]`, so
  this is just DB tidiness.
- [ ] (Optional) Next.js 14 → 16 major bump to clear the remaining `npm audit` advisories (5 high, mostly DoS / rewrites). Breaking change; do as its own session.
- [ ] (Optional, if user changes mind) Re-add Steam pickem auto-import
  via per-user Steam API key model (each user pastes their own key + auth
  code, no shared server secret).
- [ ] (Cosmetic) Friend system polish deferred from Oracle review: daily search-rate cap (currently 30/min only, fine for current scale); mask per-stage score on locked stages; `getViewerId()` helper to centralise `(session?.user as any)?.id` casts; debounce search re-fire after mutations in FriendsView.
- [ ] (Cosmetic) Add a "Pool view as default for concluded stages"
  preference — right now Rounds is always the default.
- [ ] (Cosmetic) Round-number inference for Stage 3 matches under the umbrella — they don't carry "Round N" labels, so the Rounds tab is degraded (Pool view is fine, scoring is fine).

## Security posture (don't regress)

Layered protections live in:

- `lib/rateLimit.ts` — in-memory limiter + `clientIp(req)` + `isSameOrigin(req)` (same-origin gate for state-changing POSTs).
- `app/api/sync/route.ts` — `CRON_SECRET` check via `timingSafeEqual`; **fails closed** when the env var is missing.
- `app/api/signup/route.ts` — `isSameOrigin` gate + 5 signups / hour / IP.
- `app/api/pickems/route.ts` — `isSameOrigin` gate + session auth + `teamId` validated against `TournamentTeam`.
- `app/api/refresh/route.ts` — `isSameOrigin` gate + session auth + per-user throttle (6/min) + global 20s dispatch throttle.
- `app/api/friends/*` + `app/api/users/search` — all session + `isSameOrigin` gated. Request: 30/h/user. Search: 30/min/user. `/request` catches P2002/P2003 (race + FK) so it never leaks user existence. `/respond` + `/[id]` catch P2025 so concurrent deletes return ok instead of 500. Unordered-pair unique index (see Data model) prevents two-PENDING-row race at the DB layer.
- `lib/auth.ts` — credentials `authorize` is rate-limited per email (10 attempts / 15 min) to make online brute force impractical.
- `lib/steam.ts:verifyCallback` — validates `openid.return_to` host, requires `openid.signed` to include `claimed_id`, then asks Steam for `check_authentication`.
- `next.config.mjs` — sets `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security` on all routes.

If you ever scale beyond a single Railway replica, move the in-memory limiter + the `lastDispatchAt` in `/api/refresh` into Postgres or Redis — otherwise each replica's counter is independent.

## Things to NOT do

- Don't bump Prisma to 7.x.
- Don't commit `STEAM_API_KEY` to git or expose it client-side (Next.js
  inlines `NEXT_PUBLIC_*` into the browser bundle — keep this one
  server-side only). It's set in Railway env. If leaked, Valve revokes
  it and we have to regenerate.
- Don't use `npm ci` in Railway builds (EBUSY). `npm install` is correct here.
- Don't rely on `stage.name` for headings.
- Don't expect HLTV `/results` to include team IDs.
- Don't sync from Railway runtime — only GH Actions runners get through Cloudflare.
- Don't trust `inferStageKind` heuristic alone — per-stage event IDs are
  the source of truth via `fetchStageMatches(eventId, stageKind)`.
- Don't accept `npm audit fix --force`'s suggestion to "fix" `hltv` — its
  recommendation is to downgrade to 1.1.0, which loses every API we use
  for syncing. The remaining transitive `socket.io-client` advisory only
  affects the live-streaming code path inside the scraper that we don't call.
- Don't drop the `isSameOrigin(req)` gate from any state-changing POST
  route; it's our minimum CSRF defense (we don't issue CSRF tokens).
- Don't relax the credentials per-email rate limit below ~10/15min — that's
  what keeps online password brute force expensive.
- Don't move match results or live-state pulls from HLTV to Liquipedia —
  Liquipedia is community-edited and lags 10–30 min behind real ends. The
  daily Liquipedia sync is for upcoming schedule + broadcast metadata only.
- Don't poll Liquipedia faster than daily for the schedule sync. Their
  usage policy asks for low rates + caching; the 10-min HLTV cadence is OK
  because it goes to HLTV's API, not Liquipedia.
- Don't bake stream channel handles into client code — pull from
  `Tournament.twitchChannel` / `youtubeChannel`; that's how Major changes
  with new broadcasters auto-propagate after the next daily sync.
