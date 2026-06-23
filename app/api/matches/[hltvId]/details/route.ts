// On-demand match detail endpoint: maps played + recent head-to-head.
//
// H2H source chain (each step's results merged into the next):
//   1. Local DB — fast, but only knows tournaments we've synced.
//   2. Liquipedia per-team /Matches subpage — accessible from Railway
//      (HLTV is blocked by Cloudflare from our datacenter IP). This is
//      the primary fallback in production.
//   3. HLTV.getResults filtered by teamIds — works locally + from GH
//      Actions, may fail from Railway. Tried last as a best-effort.
//
// Each source caches separately; merged + deduped + capped at 10.
//
// Maps for the specific match also come from HLTV.getMatch (cached 5 min).

import { NextResponse } from "next/server";
import HLTV from "hltv";
import { prisma } from "@/lib/db";
import { fetchLiquipediaH2H } from "@/lib/h2hLiquipedia";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MapResult {
  name: string;
  scoreA: number;
  scoreB: number;
  pick: "A" | "B" | "DECIDER" | null;
}

interface H2HEntry {
  hltvId: number | null;
  startTime: string | null;
  scoreForA: number;
  scoreForB: number;
  winnerWasA: boolean;
  winnerWasB: boolean;
  tournament: string;
  stage: string;
  source: "local" | "liquipedia" | "hltv";
}

interface MapsCacheEntry {
  at: number;
  maps: MapResult[];
}
const mapsCache = new Map<number, MapsCacheEntry>();
const MAPS_TTL = 5 * 60 * 1000;

interface H2HCacheEntry {
  at: number;
  entries: H2HEntry[];
}
const h2hCache = new Map<string, H2HCacheEntry>();
const H2H_TTL = 60 * 60 * 1000;

async function getMapsFromHltv(hltvId: number): Promise<MapResult[]> {
  const cached = mapsCache.get(hltvId);
  if (cached && Date.now() - cached.at < MAPS_TTL) return cached.maps;
  try {
    const m: any = await HLTV.getMatch({ id: hltvId });
    const maps: MapResult[] = [];
    const list: any[] = Array.isArray(m?.maps) ? m.maps : [];
    for (const mp of list) {
      const name: string = mp?.name ?? mp?.map ?? "Unknown";
      const scoreA = Number(mp?.result?.team1 ?? mp?.team1?.result ?? 0);
      const scoreB = Number(mp?.result?.team2 ?? mp?.team2?.result ?? 0);
      if (scoreA === 0 && scoreB === 0 && !mp?.result && !mp?.statusText) continue;
      const pickedBy = mp?.pickedBy ?? mp?.pick ?? null;
      let pick: MapResult["pick"] = null;
      if (pickedBy === "team1" || pickedBy === "A") pick = "A";
      else if (pickedBy === "team2" || pickedBy === "B") pick = "B";
      else if (pickedBy === "decider" || pickedBy == null) pick = "DECIDER";
      maps.push({ name, scoreA, scoreB, pick });
    }
    mapsCache.set(hltvId, { at: Date.now(), maps });
    return maps;
  } catch (e) {
    console.warn("[match details] getMatch failed:", (e as Error).message);
    return [];
  }
}

// Pull HLTV's result archive filtered by both team ids, scoped to the
// past year. Returns matches where BOTH listed teams are the supplied
// ones (HLTV returns either-team matches, so we filter client-side).
//
// Cache key uses the sorted pair so (A, B) and (B, A) share the same
// upstream call.
async function getH2HFromHltv(
  teamAHltvId: number,
  teamBHltvId: number,
  teamAName: string,
  teamBName: string,
): Promise<H2HEntry[]> {
  const cacheKey = [teamAHltvId, teamBHltvId].sort((x, y) => x - y).join(":");
  const cached = h2hCache.get(cacheKey);
  if (cached && Date.now() - cached.at < H2H_TTL) return cached.entries;

  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const startDate = oneYearAgo.toISOString().slice(0, 10);
  try {
    // HLTV typings are loose; cast the filter object so optional
    // teamIds + startDate go through. Some package versions accept
    // `teamIDs` (capital), others `teamIds`. We pass both via casting.
    const raw: any[] = (await HLTV.getResults({
      teamIds: [teamAHltvId, teamBHltvId],
      startDate,
    } as any)) as any[];

    const matches: H2HEntry[] = [];
    for (const r of raw ?? []) {
      const t1Name: string = r?.team1?.name ?? "";
      const t2Name: string = r?.team2?.name ?? "";
      const t1Id = Number(r?.team1?.id ?? 0);
      const t2Id = Number(r?.team2?.id ?? 0);
      // Identify by id when present, else fall back to name match.
      const matchesA = (t1Id && t1Id === teamAHltvId) || t1Name === teamAName;
      const matchesB = (t2Id && t2Id === teamBHltvId) || t2Name === teamBName;
      const matchesAReversed = (t1Id && t1Id === teamBHltvId) || t1Name === teamBName;
      const matchesBReversed = (t2Id && t2Id === teamAHltvId) || t2Name === teamAName;
      const matchPair = (matchesA && matchesB) || (matchesAReversed && matchesBReversed);
      if (!matchPair) continue;

      const scoreT1 = Number(r?.result?.team1 ?? r?.team1?.result ?? 0);
      const scoreT2 = Number(r?.result?.team2 ?? r?.team2?.result ?? 0);
      // Normalise to A/B perspective.
      const flipped = matchesAReversed; // team1 is actually our teamB
      const scoreForA = flipped ? scoreT2 : scoreT1;
      const scoreForB = flipped ? scoreT1 : scoreT2;
      const winnerWasA = scoreForA > scoreForB;
      const winnerWasB = scoreForB > scoreForA;

      const dateRaw = r?.date;
      const dateMs = typeof dateRaw === "number" ? dateRaw : Date.parse(String(dateRaw ?? ""));
      const startTime = Number.isFinite(dateMs) ? new Date(dateMs).toISOString() : null;

      matches.push({
        hltvId: Number(r?.id ?? 0) || null,
        startTime,
        scoreForA,
        scoreForB,
        winnerWasA,
        winnerWasB,
        tournament: r?.event?.name ?? r?.format?.name ?? "",
        stage: "",
        source: "hltv",
      });
    }
    h2hCache.set(cacheKey, { at: Date.now(), entries: matches });
    return matches;
  } catch (e) {
    console.warn("[match details] getResults H2H failed:", (e as Error).message);
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

  const dbMatch = await prisma.match.findUnique({
    where: { hltvId },
    select: {
      teamAId: true,
      teamBId: true,
      teamA: { select: { id: true, name: true, hltvId: true } },
      teamB: { select: { id: true, name: true, hltvId: true } },
    },
  });

  // Run map fetch + all three H2H sources in parallel.
  const [maps, localH2H, liquipediaH2H, hltvH2H] = await Promise.all([
    getMapsFromHltv(hltvId),
    // Source 1 — local DB.
    (async (): Promise<H2HEntry[]> => {
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
        take: 10,
      });
      return matches.map((m) => ({
        hltvId: m.hltvId,
        startTime: m.startTime?.toISOString() ?? null,
        scoreForA: m.teamAId === dbMatch.teamAId ? m.scoreA : m.scoreB,
        scoreForB: m.teamAId === dbMatch.teamAId ? m.scoreB : m.scoreA,
        winnerWasA: m.winnerId === dbMatch.teamAId,
        winnerWasB: m.winnerId === dbMatch.teamBId,
        tournament: m.stage.tournament.name,
        stage: m.stage.kind,
        source: "local" as const,
      }));
    })(),
    // Source 2 — Liquipedia /Matches subpage of teamA. Most reliable
    // path from Railway since HLTV is firewalled here.
    (async (): Promise<H2HEntry[]> => {
      if (!dbMatch?.teamA?.name || !dbMatch?.teamB?.name) return [];
      const rows = await fetchLiquipediaH2H(dbMatch.teamA.name, dbMatch.teamB.name);
      return rows.map((r) => ({
        hltvId: r.hltvId,
        startTime: r.startTime,
        scoreForA: r.scoreForA,
        scoreForB: r.scoreForB,
        winnerWasA: r.winnerWasA,
        winnerWasB: r.winnerWasB,
        tournament: r.tournament,
        stage: "",
        source: "liquipedia" as const,
      }));
    })(),
    // Source 3 — HLTV.getResults (1yr window). Best-effort; may be
    // blocked from Railway. Local + Liquipedia cover the gap.
    (async (): Promise<H2HEntry[]> => {
      const aId = dbMatch?.teamA?.hltvId;
      const bId = dbMatch?.teamB?.hltvId;
      if (!aId || !bId || !dbMatch?.teamA?.name || !dbMatch?.teamB?.name) return [];
      return getH2HFromHltv(aId, bId, dbMatch.teamA.name, dbMatch.teamB.name);
    })(),
  ]);

  // Merge all three, dedupe by hltvId when present (Liquipedia entries
  // don't have one — they dedupe by startTime+tournament). Sort newest
  // first, cap at 10.
  const merged = new Map<string, H2HEntry>();
  for (const e of [...localH2H, ...liquipediaH2H, ...hltvH2H]) {
    const key = e.hltvId
      ? `id:${e.hltvId}`
      : `t:${e.startTime?.slice(0, 10) ?? ""}|${e.tournament}`;
    if (!merged.has(key)) merged.set(key, e);
  }
  const h2h = [...merged.values()]
    .sort((x, y) => (Date.parse(y.startTime ?? "") || 0) - (Date.parse(x.startTime ?? "") || 0))
    .slice(0, 10);

  return NextResponse.json(
    {
      maps,
      h2h,
      teamA: dbMatch?.teamA ? { id: dbMatch.teamA.id, name: dbMatch.teamA.name } : null,
      teamB: dbMatch?.teamB ? { id: dbMatch.teamB.id, name: dbMatch.teamB.name } : null,
    },
    { headers: { "cache-control": "private, max-age=60" } },
  );
}
