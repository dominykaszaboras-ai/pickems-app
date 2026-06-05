# CS2 Major Pickems

A pickems site for CS2 Majors with:

- 📊 A live tournament view (Challengers / Legends Swiss stages + Champions playoff bracket)
- 🎮 A click-to-simulate UI — click a team in any unfinished match and your pickems score updates instantly
- 🔄 Automatic data sync from **hltv.org** (via the unofficial `hltv` scraping package, runs every 10 minutes on Vercel Cron)
- 🔐 Multi-user accounts (NextAuth — email/password, optional GitHub)
- 🏆 Leaderboard ranking everyone's pickems

## Stack

| | |
|--|--|
| Framework | Next.js 14 (App Router, TypeScript) |
| Styling   | Tailwind |
| DB        | Prisma + **PostgreSQL** (Railway / Neon / Supabase / local docker) |
| Auth      | NextAuth v5 (credentials + optional GitHub) |
| Scraping  | [`hltv`](https://www.npmjs.com/package/hltv) npm package |
| Schedule  | Vercel Cron → `/api/sync` |

## Project layout

```
app/
  api/
    auth/[...nextauth]/   # NextAuth handler
    signup/               # POST /api/signup  – create credentials user
    pickems/              # POST /api/pickems – save user's picks
    sync/                 # GET  /api/sync    – cron-protected HLTV sync
  auth/signin|signup/     # auth pages
  bracket/                # bracket + simulator
  pickems/                # pick submission
  leaderboard/            # everyone's scores
components/
  BracketView.tsx         # top-level interactive bracket
  SwissStage.tsx          # Challengers / Legends view
  PlayoffBracket.tsx      # Champions bracket
  MatchCard.tsx           # clickable match
  PickemsForm.tsx         # pick selection UI
  Nav.tsx, TeamLogo.tsx
lib/
  db.ts                   # Prisma client
  auth.ts                 # NextAuth config
  hltv.ts                 # HLTV scraping wrapper
  sync.ts                 # tournament/team/match upsert from HLTV
  queries.ts              # server-side data fetchers → ClientTournament
  scoring.ts              # pure pickems scoring engine (+ simulation overrides)
  types.ts                # shared client/server types
prisma/
  schema.prisma           # full data model
  seed.ts                 # fake major for offline dev
scripts/
  sync.ts                 # local CLI sync runner
vercel.json               # cron config
```

## Setup

```bash
# 1. Install
npm install

# 2. Env
cp .env.example .env
# then edit .env to set:
#   DATABASE_URL        (Postgres — see below for a quick local docker line)
#   AUTH_SECRET         (openssl rand -base64 32)
#   CRON_SECRET         (openssl rand -base64 32)
#   HLTV_EVENT_ID       (e.g. 7148 for PGL Major Copenhagen 2024 — see hltv.org/events)

# Local Postgres in one line (Docker):
#   docker run --name pickems-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16

# 3. DB
npx prisma db push        # applies schema to the Postgres instance
npm run db:seed           # OPTIONAL: load a fake "Demo Major" so the UI works without HLTV

# 4. Sync from HLTV (only after HLTV_EVENT_ID is set)
npm run sync

# 5. Run
npm run dev
# → http://localhost:3000
```

### Finding `HLTV_EVENT_ID`

Open the Major's page on hltv.org/events — the ID is in the URL, e.g.
`https://www.hltv.org/events/7148/pgl-cs2-major-copenhagen-2024` → `7148`.

## How scoring works

Standard Valve pickems format (`lib/scoring.ts` — pure & deterministic, runs on
both server and client):

- **Swiss stages (Challengers + Legends, 16 teams):**
  - 1 pt per correct *advance* pick
  - +4 bonus if your **3-0** pick goes 3-0
  - +4 bonus if your **0-3** pick goes 0-3
- **Champions playoffs (8 teams, single-elim):**
  - QF win = 1 pt · SF win = 2 pts · GF win = 4 pts · Champion = +4 pts

## Simulation mode

On the `/bracket` page, click any team in a not-yet-finished match. That team
becomes the simulated winner — and the score panel (top-right) updates live.
This uses the same `scorePickem(...)` function the leaderboard uses against
real results, just with a `WinnerOverrides` map of `matchId → teamId`.

Click "Reset simulation" to clear all overrides.

## Auto-sync

`/api/sync` is hit every 10 minutes by Vercel Cron (`vercel.json`). It is
protected by `Authorization: Bearer $CRON_SECRET`. Vercel attaches this header
automatically; if you trigger it manually, include the header yourself.

Locally, `npm run sync` runs the same logic via `scripts/sync.ts`.

## Deploying to Railway

1. Push this repo to GitHub.
2. In Railway: **New Project → Deploy from GitHub → pick this repo**.
3. Add the **PostgreSQL** plugin to the project. Railway injects `DATABASE_URL`
   into the web service automatically.
4. Set these env vars on the web service:
   - `AUTH_SECRET` — `openssl rand -base64 32`
   - `AUTH_URL` — your public Railway URL (e.g. `https://pickems-app-production.up.railway.app`)
   - `CRON_SECRET` — `openssl rand -base64 32`
   - `HLTV_EVENT_ID` — the Major's HLTV event ID (e.g. `7148`)
5. Build/start commands (already wired via `railway.json`):
   - **Build**: `npm install --no-audit --no-fund && npm run build`
   - **Start**: `npm run start:railway` (runs `prisma db push --accept-data-loss && next start`)

   The schema push happens at **start** rather than build, because Railway only
   injects plugin env vars (like `DATABASE_URL`) at runtime — they're not
   available during the Nixpacks build phase.
6. **Scheduled sync** — Railway doesn't run `vercel.json` crons. Two options:
   - **Cron service (recommended)**: in your Railway project, add a second
     service from the same repo. Set its start command to
     `node -e "fetch(process.env.SYNC_URL,{headers:{authorization:'Bearer '+process.env.CRON_SECRET}}).then(r=>r.text()).then(console.log)"`
     and configure it as a **Cron** with schedule `*/10 * * * *`. Set
     `SYNC_URL=https://<your-app>.up.railway.app/api/sync` and the same
     `CRON_SECRET` env var on it.
   - **External cron** (cron-job.org, etc.): hit
     `GET https://<your-app>.up.railway.app/api/sync` with header
     `Authorization: Bearer <CRON_SECRET>` every 10 minutes.

### Deploying to Vercel (alternative)

1. Push to GitHub, import the repo on Vercel.
2. Add a Postgres database (Vercel Postgres, Neon, or Supabase) and set
   `DATABASE_URL` to its connection string.
3. Set `AUTH_SECRET`, `CRON_SECRET`, `HLTV_EVENT_ID`.
4. Deploy — Vercel will pick up the cron from `vercel.json`.

## Caveats

- HLTV has no public API. The `hltv` package scrapes the site and can break if
  HLTV changes their HTML. We swallow errors per call so a flaky sync degrades
  gracefully (your last good snapshot stays in the DB).
- Stage assignment is best-effort: matches are bucketed into Challengers /
  Legends / Champions by inspecting HLTV labels. If a Major uses unusual
  naming, you may need to extend `inferStageKind` in `lib/hltv.ts`.
- Pickem locking is simplified: the schema supports per-stage locking via
  `lockedAt`, but the API currently only locks once tournament `startDate`
  passes. Extend `app/api/pickems/route.ts` to lock each stage independently.
