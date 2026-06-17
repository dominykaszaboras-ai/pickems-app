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
  PlayoffBracket.tsx             Playoff bracket (display + simulator on /bracket)
  PlayoffBracketPicker.tsx       Click-to-advance bracket UI on /pickems form (4 QF -> 2 SF -> 1 Final + Champion)\n  PlayoffPickBracket.tsx         Read-only mini bracket shown inside PickSummary when stage.kind === \"PLAYOFFS\"
  MatchCard.tsx                  Single match (click to simulate, HLTV ↗, TW/YT)
  PickSummary.tsx                User's picks with correctness per stage
  PickemsForm.tsx                Pick submission UI (locks unstarted stages)
  TeamLogo.tsx                   Team logo with name fallback
  RefreshButton.tsx              Triggers GH Actions sync; idle label = "Synced Xs ago"
  FriendsView.tsx                Client component for /friends (search + list + actions)
  FriendButton.tsx               Add/accept/decline/unfriend button on /users/[id]
  SteamLinkPanel.tsx             Link/Unlink Steam panel shown on the viewer's own profile
  SteamSyncCard.tsx              Paste Major Auth Code on /pickems (only when user has steamId)
  SteamCodePanel.tsx             Profile-page version of the auth-code form (paste/refresh/clear from /users/[id])
  MedalBadge.tsx                 Bronze/silver/gold/diamond medal coin next to score on profile + leaderboard

lib/
  db.ts                          Prisma singleton
  medals.ts                      Medal tiers + getMedal() (1-5 bronze, 6-15 silver, 16-25 gold, 26+ diamond)
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
  probe-steam-pickem.ts          Diagnostic: enumerate Valve pickem event IDs via GetTournamentLayout/v1 (no DB; needs STEAM_API_KEY)
  probe-steam-upload.ts          Diagnostic: re-upload a user's existing stored predictions to UploadTournamentPredictions/v1 (no-op, useful for confirming body format)
  steam-pickem-sync.ts           Cron: bidirectional pull+push for every user with a Major Auth Code (every 6h via GH Actions)
  inspect-teams.ts               Diagnostic: teams per stage
  inspect-pickems.ts             Diagnostic: dump saved picks with team names
  migrate-stage-kinds.ts         One-off: rename CHALLENGERS→STAGE_1 etc (run; idempotent)
  backfill-steam-profiles.ts     One-off: refresh Steam users' name+image (run; idempotent)
  backfill-stage-names.ts        One-off: rewrite Stage.name + drop stale 9029 (run if not done)

.github/workflows/
  sync.yml                       HLTV sync — every 10 minutes
  live-sync.yml                  HLTV live sync — every 2 minutes
  sync-schedule.yml              Liquipedia schedule + broadcasts — daily @ 05:30 UTC
  steam-pickem-sync.yml          Steam pickem bidirectional sync — every 6h
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

## Valve pickem event ID (per-major)

Valve has its own internal numeric event id per Major, separate from
HLTV's. Found via `scripts/probe-steam-pickem.ts` (enumerates `GetTournamentLayout/v1`):

| Major | Valve event id |
|---|---|
| StarLadder Budapest 2025 | `25` |
| IEM Cologne 2026 | **`26`** (currently set on Railway as `STEAM_PICKEM_EVENT_ID`) |

Layout schema we observed for event 26 — use this when building the
mapper:

```
result:
  event: 26
  name: "IEM Cologne 2026 CS2 Major Championship"
  teams: [ { pickid, logo, name } ]  // ~32 entries; pickid IS the stable team id
  sections: [
    { sectionid: 105, name: "Stage I | 1",     groups: [ { groupid: 271, picks: [10 slots] } ] },
    { sectionid: 106, name: "Stage II | 2",    groups: [ { groupid: 272, picks: [10 slots] } ] },
    { sectionid: 107, name: "Stage III | 3",   groups: [ { groupid: 273, picks: [10 slots] } ] },
    { sectionid: 108, name: "Quarterfinals",   groups: [ 4 × 1-slot ] },  // groupids 274-277
    { sectionid: 109, name: "Semifinals",      groups: [ 2 × 1-slot ] },  // groupids 278-279
    { sectionid: 110, name: "Grand Final",     groups: [ 1 × 1-slot ] },  // groupid 280
  ]
```

Each slot is `{ index, pickids: number[] }`. In `GetTournamentLayout`,
`pickids` is empty; in `GetTournamentPredictions` it's filled with the
team's `pickid` from the top-level `teams` array.

**Confirmed against a real GetTournamentPredictions response (2026-06-16):**
- Stage I/II/III index ordering: `[0, 1]` are SWISS_3_0, `[2..7]` are SWISS_ADVANCE, `[8, 9]` are SWISS_0_3.
- Predictions response shape is `{ result: { picks: [ { groupid, index, pick } ] } }` — NOT `result.predictions`, and field name is `pick` not `pickid`. `extractPredictions` checks both shapes.
- Grand Final groupid=280 stores ONE team — the user's pick for who wins the Major. Our read mapper duplicates it into BOTH `PLAYOFF_WINNER round=3` (Final match) and `round=4` (Champion) since they're necessarily the same team.
- QF/SF/GF group ids 274-280 follow bracket order, but our scoring doesn't actually need to know which specific QF match — only the team and the round.

## HLTV event IDs (per-major data)

Cologne 2026 splits SOME stages into their own HLTV event; Stage 3 lives on the umbrella:

| Stage | Event ID | Notes |
|---|---|---|
| Umbrella (teams, dates, name) | `8301` | The /events/8301/... URL on HLTV |
| Stage 1 | `9028` | Concluded |
| Stage 2 | `9029` | Concluded |
| Stage 3 | `8301` | **No separate sub-event — matches live directly on the umbrella.** `fetchStageMatches(8301, STAGE_3)` filters by event.id; Stage 1/2 matches live under 9028/9029 so there's no overlap. |
| Playoffs | **Liquipedia-only** (no HLTV stage id) | HLTV bundles playoffs under the same umbrella id (8301) as Stage 3, and `fetchStageMatches` only filters by event id (then force-tags `stageKind`), so adding `PLAYOFFS:8301` would double-write every match. Playoff bracket data is pulled exclusively from Liquipedia via `fetchSchedule(COLOGNE_2026_LIQUIPEDIA)` — the `PLAYOFFS` entry there points to `Intel_Extreme_Masters/2026/Cologne/Playoffs`. Verified working: parser returns all 4 QFs (2026-06-18). Live scores still adopt from HLTV via ghost-matching by team+time. |

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

# Diagnostics — Valve pickem event ID hunt (no DB; needs STEAM_API_KEY)
STEAM_API_KEY="..." npx tsx scripts/probe-steam-pickem.ts            # range 1..40
STEAM_API_KEY="..." npx tsx scripts/probe-steam-pickem.ts 20 60      # custom range
STEAM_API_KEY="..." npx tsx scripts/probe-steam-pickem.ts 26         # dump full JSON for one id

# Diagnostic — Valve UploadTournamentPredictions/v1 (re-uploads user's stored picks; no-op)
DATABASE_URL="..." STEAM_API_KEY="..." STEAM_PICKEM_EVENT_ID=26 \
  npx tsx scripts/probe-steam-upload.ts <userId>

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

- [x] **Playoffs sourced from Liquipedia** (2026-06-16). HLTV doesn't separate playoffs from Stage 3 (both at event 8301) and `fetchStageMatches` would double-write — so `PLAYOFFS` is NOT in `HLTV_STAGE_EVENTS` anymore (reverted to `STAGE_1:9028,STAGE_2:9029,STAGE_3:8301` on both GH secret + Railway env). `COLOGNE_2026_LIQUIPEDIA.PLAYOFFS` already points at the right wiki page; the existing `parseLiquipediaMatches` parser handles the playoff bracket HTML and returns all 4 QFs. Live scores still adopt from HLTV via ghost-matching by team+time.
- [ ] **Owner: update `HLTV_STAGE_EVENTS` on Railway** to `STAGE_1:9028,STAGE_2:9029,STAGE_3:8301`. Cron runs from GH Actions so syncs work today; the Railway env only matters for `/api/sync` direct calls (Refresh button still dispatches GH).
- [x] **Rotated Postgres password** (2026-06-14). Regenerated `POSTGRES_PASSWORD` via Railway's variable generator → Railway re-ALTERed the DB user + rebuilt templated `DATABASE_URL` / `DATABASE_PUBLIC_URL` → `pickems-app` redeployed via the `${{Postgres.DATABASE_URL}}` reference. GH Actions `DATABASE_URL` secret updated via `gh secret set`. All three sync workflows verified green afterward.
- [x] **In-app friend system** (2026-06-15). Search-and-add friends by display name (no Steam API). `/friends` management page, `/users/[id]` profile with per-stage pick lock, leaderboard Friends-only toggle, avatar dropdown in Nav. See Data model + Security posture sections for full detail.
- [x] **Steam linking on existing accounts** (2026-06-16). New `/api/auth/steam/link` + `/api/auth/steam/link/callback` routes let a signed-in email user attach a SteamID without creating a fresh row. `/api/auth/steam/unlink` POST detaches, but refuses if the user has no email+passwordHash fallback (would lock themselves out). UI lives in `SteamLinkPanel` on the viewer's own profile page. Conflict cases handled: already-yours, already-linked-to-current-user, SteamID owned by another user (P2002).
- [x] **Pickem auto-import via Steam Web API** (2026-06-16). User pastes their per-Major "Major Auth Code" (`steamidkey`) from help.steampowered.com on `/pickems` (only visible when they have a linked SteamID). `/api/pickems/sync-steam` calls `ICSGOTournaments_730/GetTournamentLayout/v1` + `GetTournamentPredictions/v1`, stores raw JSON on `User.steamPickemRaw` (+ code on `steamPickemCode`), returns prediction count. **Mapping Valve's predictions -> our PickemPick rows is the active Phase 2 work** — layout schema is known (below), but we need one real `GetTournamentPredictions` response (i.e. someone pastes their auth code) to confirm the index→kind ordering before committing to it. `STEAM_API_KEY` and `STEAM_PICKEM_EVENT_ID=26` set on Railway (2026-06-16).
- [x] **Playoff picker rebuilt as bracket UI** (2026-06-16). Replaced the old PlayoffsPicker (4 dropdowns) with `PlayoffBracketPicker` — CS2-style click-to-advance bracket. 4 QF matchups stack on the left, click a team to advance them; SF candidates derive from your QF picks (SF1 = winner(QF1) vs winner(QF2)); Final candidates derive from SFs; Champion auto-fills with the Final winner. Changing an upstream pick cleanly invalidates stale downstream picks via the `rebuild()` helper in the picker. The form now stores playoff picks as `Array<{round, teamId}>` so we can hold the full Cologne 2026 format (4+2+1+1 = 8 picks) — the old `Record<number, string|null>` could only hold 1 per round.
- [x] **Phase 2 — Valve -> PickemPick read mapper** (2026-06-16). `lib/steamPickems.ts` ships `parseSteamLayout()` (turns `GetTournamentLayout` JSON into `{byPickid, bySlot}`) and `steamPicksToLocal()` (predictions array + team name map -> our PickemPick rows). Confirmed against a real Cologne 2026 response: index ordering is `[0,1]=3-0`, `[2..7]=advance`, `[8,9]=0-3` (NOT the `[2,3]=0-3` I'd assumed). Section names matched by substring ("Stage I", "Quarterfinals", "Grand Final"). Grand Final pick is duplicated into round=3 (Final) AND round=4 (Champion). `/api/pickems/sync-steam` now writes mapped picks straight to PickemPick rows, replacing ONLY the stages Steam returned (preserves locally-entered picks for stages Steam doesn't have yet, e.g. playoffs not open).
- [x] **Periodic Steam pickem sync** (2026-06-17). `scripts/steam-pickem-sync.ts` + `.github/workflows/steam-pickem-sync.yml` run every 6h. For each user with `steamPickemCode` set, the cron (a) pulls fresh predictions from Valve (handles "user placed picks in CS2 directly"), then (b) re-uploads the user's local PickemPick rows to Valve (handles "webapp picks saved while Valve's prediction window was closed"). 3s delay between users to stay well under the 100k/day key quota. Both `STEAM_API_KEY` and `STEAM_PICKEM_EVENT_ID` are mirrored to GH secrets so the workflow can run.
- [x] **Sync indicator + last-sync timestamp** (2026-06-17). When a user has a `steamPickemCode` on file, `SteamSyncCard` and the new `SteamCodePanel` (on profile) show "✓ Synced — auth code on file" with the masked code and a `formatAgo()` of the last refresh derived from the `at` field in `steamPickemRaw`.
- [x] **Medal tier system** (2026-06-17). `lib/medals.ts` defines four tiers based on correct-pick count (1-5 bronze, 6-15 silver, 16-25 gold, 26+ diamond). `MedalBadge` component renders the appropriate emoji + tooltip. Wired into the profile score card and the leaderboard table (new "Medal" column).
- [x] **Auth code panel on profile** (2026-06-17). `SteamCodePanel` rendered on `/users/[id]` when the viewer is signed in as the profile owner AND has Steam linked. Lets them paste / refresh the Major Auth Code without going to `/pickems`. Posts to the same `/api/pickems/sync-steam` route.
- [x] **Steam upload itemid resolution + state-based error codes** (2026-06-17). `UploadTournamentPredictions/v1` accepts our format but Valve cares about both `pickid` (team) AND `itemid` (the user's PERSONAL 20-digit inventory item id for that team's sticker). Added `getTournamentItems()` which calls `ICSGOTournaments_730/GetTournamentItems/v1` (auth-code-gated) and returns `Map<teamid, itemid string>`. The reverse mapper now threads itemid through localPicksToSteam -> uploadTournamentPredictions. Empirical Valve error map: `410 Gone` = stage concluded; `412 Precondition Failed` = slot already filled in CS2 (Valve refuses third-party overwrite); `400 Bad Request` = malformed body OR section not open yet. For users who FIRST place their picks via our webapp (empty slots), upload should succeed and they earn the Major sticker without opening CS2. For users who pre-locked in CS2, the 412 is structural — not a bug. The cron retries every 6h to catch the moment the section opens.\n- [x] **Phase 3 — write-back to Steam on pickem save** (2026-06-16). `/api/pickems` POST now does a best-effort `UploadTournamentPredictions/v1` push after the local save. Eligible when the user has Steam linked AND a `steamPickemCode` on file AND `syncToSteam` isn't disabled (default on, persisted in localStorage). Save never fails on Steam errors — we return a `steamPush` object (`{attempted, ok, uploaded, reason}`) so the form can show "Synced N picks to Steam" or "Saved locally; Steam hasn't opened those picks for upload yet". Body format Valve actually accepts is repeated top-level form fields: `sectionid`, `groupid`, `index`, `pickid`, `itemid` (itemid = pickid empirically). Verified by re-uploading a user's existing Swiss picks and getting 410 "Gone" (stages closed) instead of 400 (= format accepted). Playoff uploads to event 26 currently return 400 until Valve opens the playoff prediction window post-Stage 3.
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
