// Pull the HLTV event snapshot and persist it into our DB.
// Idempotent: safe to call repeatedly.
//
// In Cologne 2026 each Major stage is a separate HLTV event:
//   - `umbrellaEventId` (e.g. 8301) gives us the team list + tournament name
//   - `stageEvents` maps each StageKind to its own HLTV event id
//     (e.g. STAGE_1 -> 9028, STAGE_2 -> 9029) and we pull matches from there
//
// The HLTV_STAGE_EVENTS env var encodes the mapping, e.g.
//   HLTV_STAGE_EVENTS="STAGE_1:9028,STAGE_2:9029,STAGE_3:9030,PLAYOFFS:9031"

import { prisma } from "./db";
import {
  fetchEventSnapshot,
  fetchMatchLiveState,
  fetchStageMatches,
  fetchTeamLogo,
} from "./hltv";
import type { StageKind } from "./types";

export type StageEventMap = Partial<Record<StageKind, number>>;

// Cheap, frequent live-state refresh. Pulls every match we currently track
// as LIVE (or PENDING-but-scheduled-to-start-soon), hits HLTV.getMatch for
// each, and updates scoreA/scoreB/status/winnerId. Designed to run every
// 2-3 minutes from a dedicated GH Actions workflow.
export async function syncLiveMatches(): Promise<{
  inspected: number;
  updated: number;
  liveAfter: number;
}> {
  const lookaheadMs = 30 * 60 * 1000; // start tracking 30 min before listed time
  const now = Date.now();
  const candidates = await prisma.match.findMany({
    where: {
      hltvId: { not: null },
      OR: [
        { status: "LIVE" },
        {
          status: "PENDING",
          startTime: { gte: new Date(now - lookaheadMs), lte: new Date(now + lookaheadMs) },
        },
      ],
    },
    include: { teamA: true, teamB: true },
  });

  let updated = 0;
  let liveAfter = 0;
  for (const m of candidates) {
    if (!m.hltvId) continue;
    const live = await fetchMatchLiveState(m.hltvId);
    if (!live) continue;

    // Resolve winner by name -> teamId.
    let winnerId: string | null = null;
    if (live.winnerName) {
      const w = await prisma.team.findUnique({ where: { name: live.winnerName } });
      if (w) winnerId = w.id;
    }

    await prisma.match.update({
      where: { id: m.id },
      data: {
        scoreA: live.scoreA,
        scoreB: live.scoreB,
        status: live.status,
        winnerId: live.status === "FINISHED" ? winnerId : null,
      },
    });
    updated++;
    if (live.status === "LIVE") liveAfter++;
  }

  return { inspected: candidates.length, updated, liveAfter };
}

export function parseStageEvents(raw: string | undefined): StageEventMap {
  if (!raw) return {};
  const out: StageEventMap = {};
  for (const segment of raw.split(",")) {
    const [k, v] = segment.split(":").map((s) => s.trim());
    const id = Number(v);
    if (!k || !id) continue;
    if (k === "STAGE_1" || k === "STAGE_2" || k === "STAGE_3" || k === "PLAYOFFS") {
      out[k] = id;
    }
  }
  return out;
}

const STAGE_NAMES: Record<StageKind, string> = {
  STAGE_1: "Stage 1 (Swiss)",
  STAGE_2: "Stage 2 (Swiss)",
  STAGE_3: "Stage 3 (Swiss)",
  PLAYOFFS: "Playoffs",
};

export async function syncTournament(
  hltvEventId: number,
  stageEvents: StageEventMap = {},
) {
  const snap = await fetchEventSnapshot(hltvEventId);

  // 1. Upsert tournament. If the umbrella getEvent got Cloudflare-blocked we
  // fall back to keeping whatever name/dates the row already had, so a
  // transient block doesn't blank out the tournament record. The
  // lastSyncedAt update still happens so we can see attempts.
  const existing = await prisma.tournament.findUnique({ where: { hltvEventId } });
  const fallbackName = existing?.name ?? `HLTV Event ${hltvEventId}`;
  const name = snap.name?.startsWith("HLTV Event ") ? fallbackName : snap.name;
  const slug = slugify(name) + "-" + hltvEventId;
  const tournament = await prisma.tournament.upsert({
    where: { hltvEventId },
    update: {
      name,
      slug,
      startDate: snap.startDate ?? undefined,
      endDate: snap.endDate ?? undefined,
      lastSyncedAt: new Date(),
    },
    create: {
      hltvEventId,
      name,
      slug,
      startDate: snap.startDate ?? undefined,
      endDate: snap.endDate ?? undefined,
      lastSyncedAt: new Date(),
    },
  });

  // 2. Upsert umbrella teams + tournament-team link. We dedupe primarily by
  // name (case-insensitive normalised), since HLTV's per-event team listing
  // does still include ids — but newer endpoints don't. Falling through to
  // name keeps both pathways working.
  const teamIdByName = new Map<string, string>(); // key: lowercase name
  for (const t of snap.teams) {
    if (!t.name) continue;
    const key = t.name.toLowerCase();
    const team = await prisma.team.upsert({
      where: { name: t.name },
      update: { hltvId: t.hltvId || undefined, logo: t.logo ?? undefined },
      create: { name: t.name, hltvId: t.hltvId || null, logo: t.logo ?? null },
    });
    teamIdByName.set(key, team.id);
    await prisma.tournamentTeam.upsert({
      where: { tournamentId_teamId: { tournamentId: tournament.id, teamId: team.id } },
      update: {},
      create: { tournamentId: tournament.id, teamId: team.id },
    });
  }

  // 3. Make sure all four stages exist.
  const stageIdByKind: Record<StageKind, string> = {
    STAGE_1: "",
    STAGE_2: "",
    STAGE_3: "",
    PLAYOFFS: "",
  };
  for (const kind of ["STAGE_1", "STAGE_2", "STAGE_3", "PLAYOFFS"] as StageKind[]) {
    const stage = await prisma.stage.upsert({
      where: { tournamentId_kind: { tournamentId: tournament.id, kind } },
      // Keep the human-readable name in sync with STAGE_NAMES so the UI
      // never shows stale strings from before the Cologne-2026 rename.
      update: { name: STAGE_NAMES[kind] },
      create: { tournamentId: tournament.id, kind, name: STAGE_NAMES[kind] },
    });
    stageIdByKind[kind] = stage.id;
  }

  // 4a. Match list: prefer per-stage event IDs (Cologne-style), and fall back
  // to whatever we got under the umbrella event for completeness.
  //
  // When a stage event id is shared (either equal to the umbrella id, or used
  // by more than one stage in the map), opt into per-match disambiguation so
  // playoff QFs labelled "Quarter-final" don't get force-stamped with the
  // sibling stage kind (e.g. STAGE_3 in Cologne 2026, where event 8301 hosts
  // BOTH Stage 3 swiss matches AND the playoff bracket).
  const eventIdCounts = new Map<number, number>();
  for (const id of Object.values(stageEvents)) {
    if (!id) continue;
    eventIdCounts.set(id, (eventIdCounts.get(id) ?? 0) + 1);
  }
  const stageMatches = [] as Awaited<ReturnType<typeof fetchStageMatches>>;
  for (const [kind, evId] of Object.entries(stageEvents) as Array<[StageKind, number]>) {
    if (!evId) continue;
    const disambiguatePlayoffs =
      evId === hltvEventId || (eventIdCounts.get(evId) ?? 0) > 1;
    try {
      const ms = await fetchStageMatches(evId, kind, { disambiguatePlayoffs });
      stageMatches.push(...ms);
    } catch (e) {
      console.warn(`[sync] stage ${kind} (event ${evId}) failed:`, (e as Error).message);
    }
  }
  const all = [...snap.resultMatches, ...snap.upcomingMatches, ...stageMatches];

  // 4b. Upsert (results first, finished state wins).
  for (const m of all) {
    if (!m.hltvId) continue;
    const stageKind = m.stageKind;
    if (!stageKind) continue; // umbrella-pulled matches without a stage hint are ignored

    const teamAId = await ensureTeamByName(m.teamAName, m.teamAHltvId, m.teamALogo, teamIdByName);
    const teamBId = await ensureTeamByName(m.teamBName, m.teamBHltvId, m.teamBLogo, teamIdByName);
    const winnerId = m.winnerName ? teamIdByName.get(m.winnerName.toLowerCase()) ?? null : null;

    // Ghost adoption: if the daily Liquipedia schedule sync already wrote a
    // PENDING row for these two teams with no hltvId, claim it by stamping
    // the now-known hltvId on it AND re-targeting its stageId to whatever
    // we resolved this run. That way the upsert below finds the same row
    // instead of creating a duplicate.
    //
    // We scope by (tournamentId, team pair) — NOT by stageId — because the
    // ghost may have been written under a different stage kind than this
    // sync resolved (e.g. Liquipedia wrote PLAYOFFS but a pre-disambiguation
    // sync force-tagged the HLTV match as STAGE_3). Cross-stage adoption is
    // safe: two teams rarely play each other across multiple stages of the
    // same Major, and even then the hltvId upsert keeps things idempotent.
    if (teamAId && teamBId) {
      const ghost = await prisma.match.findFirst({
        where: {
          hltvId: null,
          status: "PENDING",
          stage: { tournamentId: tournament.id },
          OR: [
            { teamAId, teamBId },
            { teamAId: teamBId, teamBId: teamAId },
          ],
        },
        select: { id: true },
      });
      if (ghost) {
        await prisma.match.update({
          where: { id: ghost.id },
          data: {
            hltvId: m.hltvId,
            stageId: stageIdByKind[stageKind],
          },
        });
      }
    }

    // IMPORTANT: the update clause intentionally OMITS stageId,
    // bracketRound, and bracketSlot. HLTV's per-match label is unreliable
    // (the Cologne 2026 event 8301 hosts both Stage 3 and Playoffs under
    // the same event id and provides no per-match playoff signal), so
    // letting every sync re-stamp the stage based on the force-tagged
    // stageKind would drag manually-placed playoff matches back to
    // STAGE_3 on every cron. Once a match is placed (whether by ghost
    // adoption, the create-path here, or an operator script), its
    // bracket position is locked. Scores, status, winner, teams, and
    // startTime still update normally.
    await prisma.match.upsert({
      where: { hltvId: m.hltvId },
      update: {
        swissRound: m.swissRound ?? undefined,
        teamAId,
        teamBId,
        scoreA: m.scoreA,
        scoreB: m.scoreB,
        bestOf: m.bestOf,
        status: m.status,
        startTime: m.startTime ?? undefined,
        winnerId,
      },
      create: {
        hltvId: m.hltvId,
        stageId: stageIdByKind[stageKind],
        swissRound: m.swissRound,
        bracketRound: m.bracketRound,
        teamAId,
        teamBId,
        scoreA: m.scoreA,
        scoreB: m.scoreB,
        bestOf: m.bestOf,
        status: m.status,
        startTime: m.startTime,
        winnerId,
      },
    });
  }

  // 5. Backfill missing team logos by calling HLTV.getTeam(id) — only for
  // teams that still have no logo AND have a known hltvId. The results
  // response carries logos inline now, so this only runs for teams whose
  // logo was missing from the response.
  const teamsNeedingLogo = await prisma.team.findMany({
    where: {
      logo: null,
      hltvId: { not: null },
      OR: [
        { tournaments: { some: { tournamentId: tournament.id } } },
        { matchesA: { some: { stage: { tournamentId: tournament.id } } } },
        { matchesB: { some: { stage: { tournamentId: tournament.id } } } },
      ],
    },
    select: { id: true, hltvId: true },
  });
  let logosFetched = 0;
  for (const t of teamsNeedingLogo) {
    if (!t.hltvId) continue;
    const logo = await fetchTeamLogo(t.hltvId);
    if (logo) {
      await prisma.team.update({ where: { id: t.id }, data: { logo } });
      logosFetched++;
    }
  }

  return {
    tournamentId: tournament.id,
    name: tournament.name,
    slug: tournament.slug,
    matchesPulled: all.length,
    stages: Object.keys(stageEvents),
    logosFetched,
  };
}

// Look up a team by name (case-insensitive cache key), creating it on first
// sight. We also opportunistically backfill hltvId and logo when we have
// them and the row doesn't yet. HLTV's results endpoint dropped team ids,
// so name is the only stable identifier we can rely on going forward.
async function ensureTeamByName(
  name: string | null,
  hltvId: number | null,
  logo: string | null,
  cache: Map<string, string>,
): Promise<string | null> {
  if (!name) return null;
  const key = name.toLowerCase();
  const cached = cache.get(key);
  if (cached) {
    // Even on a cache hit, backfill the logo if we just learned it.
    if (logo) {
      await prisma.team.updateMany({
        where: { id: cached, logo: null },
        data: { logo },
      });
    }
    return cached;
  }
  const team = await prisma.team.upsert({
    where: { name },
    update: {
      hltvId: hltvId || undefined,
      logo: logo ?? undefined,
    },
    create: {
      name,
      hltvId: hltvId || null,
      logo: logo ?? null,
    },
  });
  cache.set(key, team.id);
  return team.id;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80);
}
