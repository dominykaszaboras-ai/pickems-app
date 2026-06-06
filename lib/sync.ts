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
import { fetchEventSnapshot, fetchStageMatches } from "./hltv";
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

  // 2. Upsert teams and tournament-team link.
  const teamIdByHltv = new Map<number, string>();
  for (const t of snap.teams) {
    if (!t.hltvId) continue;
    const team = await prisma.team.upsert({
      where: { hltvId: t.hltvId },
      update: { name: t.name, logo: t.logo },
      create: { hltvId: t.hltvId, name: t.name, logo: t.logo },
    });
    teamIdByHltv.set(t.hltvId, team.id);
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

    const teamAId = await ensureTeam(m.teamAHltvId, m.teamAName, teamIdByHltv);
    const teamBId = await ensureTeam(m.teamBHltvId, m.teamBName, teamIdByHltv);
    const winnerId =
      m.winnerHltvId && teamIdByHltv.get(m.winnerHltvId)
        ? teamIdByHltv.get(m.winnerHltvId)!
        : null;

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

  return {
    tournamentId: tournament.id,
    name: tournament.name,
    slug: tournament.slug,
    matchesPulled: all.length,
    stages: Object.keys(stageEvents),
  };
}

async function ensureTeam(
  hltvId: number | null,
  name: string | null,
  cache: Map<number, string>,
): Promise<string | null> {
  if (!hltvId) return null;
  const cached = cache.get(hltvId);
  if (cached) return cached;
  const team = await prisma.team.upsert({
    where: { hltvId },
    update: name ? { name } : {},
    create: { hltvId, name: name ?? `Team ${hltvId}` },
  });
  cache.set(hltvId, team.id);
  return team.id;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80);
}
