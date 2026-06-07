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
import { fetchEventSnapshot, fetchStageMatches, fetchTeamLogo } from "./hltv";
import type { StageKind } from "./types";

export type StageEventMap = Partial<Record<StageKind, number>>;

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

  // 1. Upsert tournament.
  const slug = slugify(snap.name) + "-" + hltvEventId;
  const tournament = await prisma.tournament.upsert({
    where: { hltvEventId },
    update: {
      name: snap.name,
      slug,
      startDate: snap.startDate ?? undefined,
      endDate: snap.endDate ?? undefined,
      lastSyncedAt: new Date(),
    },
    create: {
      hltvEventId,
      name: snap.name,
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
      update: {},
      create: { tournamentId: tournament.id, kind, name: STAGE_NAMES[kind] },
    });
    stageIdByKind[kind] = stage.id;
  }

  // 4a. Match list: prefer per-stage event IDs (Cologne-style), and fall back
  // to whatever we got under the umbrella event for completeness.
  const stageMatches = [] as Awaited<ReturnType<typeof fetchStageMatches>>;
  for (const [kind, evId] of Object.entries(stageEvents) as Array<[StageKind, number]>) {
    if (!evId) continue;
    try {
      const ms = await fetchStageMatches(evId, kind);
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

    await prisma.match.upsert({
      where: { hltvId: m.hltvId },
      update: {
        stageId: stageIdByKind[stageKind],
        swissRound: m.swissRound ?? undefined,
        bracketRound: m.bracketRound ?? undefined,
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
