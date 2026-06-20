// On-demand match detail endpoint: maps played + recent head-to-head.
//
// We don't store per-map results in Postgres — they're niche and would
// roughly triple the Match row count for a tournament. Instead this
// endpoint hits HLTV.getMatch (one upstream call) and parses the maps
// out of the response on demand. Result cached in-process for 5 min so
// rapid expand/collapse cycles don't burn HLTV calls.
//
// Head-to-head is derived purely from our own DB — the recent matches
// between the two teams across all tournaments we've ever synced. No
// extra HLTV calls needed for that.

import { NextResponse } from "next/server";
import HLTV from "hltv";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MapResult {
  name: string;
  scoreA: number;
  scoreB: number;
  pick: "A" | "B" | "DECIDER" | null;
}

interface CacheEntry {
  at: number;
  maps: MapResult[];
}
const cache = new Map<number, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000;

async function getMapsFromHltv(hltvId: number): Promise<MapResult[]> {
  const cached = cache.get(hltvId);
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.maps;
  try {
    const m: any = await HLTV.getMatch({ id: hltvId });
    const maps: MapResult[] = [];
    const list: any[] = Array.isArray(m?.maps) ? m.maps : [];
    for (const mp of list) {
      const name: string = mp?.name ?? mp?.map ?? "Unknown";
      const scoreA = Number(mp?.result?.team1 ?? mp?.team1?.result ?? 0);
      const scoreB = Number(mp?.result?.team2 ?? mp?.team2?.result ?? 0);
      // Skip maps that were never played (e.g. listed but not on schedule).
      if (scoreA === 0 && scoreB === 0 && !mp?.result && !mp?.statusText) continue;
      const pickedBy = mp?.pickedBy ?? mp?.pick ?? null;
      let pick: MapResult["pick"] = null;
      if (pickedBy === "team1" || pickedBy === "A") pick = "A";
      else if (pickedBy === "team2" || pickedBy === "B") pick = "B";
      else if (pickedBy === "decider" || pickedBy == null) pick = "DECIDER";
      maps.push({ name, scoreA, scoreB, pick });
    }
    cache.set(hltvId, { at: Date.now(), maps });
    return maps;
  } catch (e) {
    console.warn("[match details] getMatch failed:", (e as Error).message);
    return [];
  }
}

export async function GET(
  _req: Request,
  { params }: { params: { hltvId: string } },
) {
  const hltvId = Number(params.hltvId);
  if (!Number.isFinite(hltvId) || hltvId <= 0) {
    return NextResponse.json({ error: "bad hltvId" }, { status: 400 });
  }

  // Resolve the two teams from our DB so we can do the H2H lookup.
  const dbMatch = await prisma.match.findUnique({
    where: { hltvId },
    select: {
      teamAId: true,
      teamBId: true,
      teamA: { select: { id: true, name: true } },
      teamB: { select: { id: true, name: true } },
    },
  });

  // Run HLTV fetch + H2H query in parallel.
  const [maps, h2h] = await Promise.all([
    getMapsFromHltv(hltvId),
    (async () => {
      if (!dbMatch?.teamAId || !dbMatch?.teamBId) return [];
      const matches = await prisma.match.findMany({
        where: {
          status: "FINISHED",
          OR: [
            { teamAId: dbMatch.teamAId, teamBId: dbMatch.teamBId },
            { teamAId: dbMatch.teamBId, teamBId: dbMatch.teamAId },
          ],
          NOT: { hltvId },
        },
        select: {
          id: true,
          hltvId: true,
          scoreA: true,
          scoreB: true,
          startTime: true,
          winnerId: true,
          teamAId: true,
          teamBId: true,
          stage: { select: { kind: true, tournament: { select: { name: true } } } },
        },
        orderBy: { startTime: "desc" },
        take: 5,
      });
      return matches.map((m) => ({
        hltvId: m.hltvId,
        startTime: m.startTime,
        // Normalise scores from the perspective of dbMatch.teamA.
        scoreForA: m.teamAId === dbMatch.teamAId ? m.scoreA : m.scoreB,
        scoreForB: m.teamAId === dbMatch.teamAId ? m.scoreB : m.scoreA,
        winnerWasA: m.winnerId === dbMatch.teamAId,
        winnerWasB: m.winnerId === dbMatch.teamBId,
        tournament: m.stage.tournament.name,
        stage: m.stage.kind,
      }));
    })(),
  ]);

  return NextResponse.json(
    {
      maps,
      h2h,
      teamA: dbMatch?.teamA ?? null,
      teamB: dbMatch?.teamB ?? null,
    },
    { headers: { "cache-control": "private, max-age=60" } },
  );
}
