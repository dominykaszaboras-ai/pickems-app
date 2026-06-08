// Thin wrapper around the unofficial `hltv` npm package.
// HLTV has no public API; this scrapes the public website. Be polite (low frequency).
//
// We expose only the calls we actually use. The `hltv` package types are loose,
// so we narrow the shapes we depend on.
//
// NOTE: This runs on the Node runtime only (not Edge). The /api/sync route opts in
// to `runtime = "nodejs"`.

import HLTV from "hltv";
import type { StageKind } from "./types";

export interface HltvTeam {
  hltvId: number;
  name: string;
  logo: string | null;
}

export interface HltvMatch {
  hltvId: number;
  // Best guess from the event page: "Challengers", "Legends", "Champions", or null
  stageKind: StageKind | null;
  // For Swiss only — the round number derived from match label (e.g. "Round 3")
  swissRound: number | null;
  // For playoffs — derived from stage name ("Quarter-final", "Semi-final", "Grand Final")
  bracketRound: number | null;
  // HLTV's response shape dropped team IDs from /results — we identify by
  // name now and carry the logo through alongside, so sync can populate
  // the Team row without a second getTeam call.
  teamAHltvId: number | null;
  teamBHltvId: number | null;
  teamAName: string | null;
  teamBName: string | null;
  teamALogo: string | null;
  teamBLogo: string | null;
  scoreA: number;
  scoreB: number;
  bestOf: number;
  // PENDING | LIVE | FINISHED
  status: "PENDING" | "LIVE" | "FINISHED";
  startTime: Date | null;
  winnerName: string | null;
}

export interface HltvEventSnapshot {
  hltvEventId: number;
  name: string;
  startDate: Date | null;
  endDate: Date | null;
  teams: HltvTeam[];
  upcomingMatches: HltvMatch[];
  resultMatches: HltvMatch[];
}

// --- Public API --------------------------------------------------------------

// Pull the live state of a single match — current map score, live flag,
// and (if the series just ended) the winner. Used by the fast live-sync
// pass to refresh in-progress matches every couple of minutes without
// re-pulling the whole event.
export interface HltvLiveState {
  scoreA: number;
  scoreB: number;
  status: "PENDING" | "LIVE" | "FINISHED";
  winnerName: string | null;
}

export async function fetchMatchLiveState(hltvId: number): Promise<HltvLiveState | null> {
  try {
    const m = (await HLTV.getMatch({ id: hltvId })) as any;
    const status: HltvLiveState["status"] = m?.live
      ? "LIVE"
      : m?.status === "Match over" || m?.statusText === "Match over"
      ? "FINISHED"
      : m?.maps?.some?.((x: any) => x?.statusText === "Final" || x?.result)
      ? // Some completed matches show maps[].result but no `live` flag.
        "FINISHED"
      : "PENDING";

    // Series score = number of finished maps each side won.
    let scoreA = 0;
    let scoreB = 0;
    const maps: any[] = Array.isArray(m?.maps) ? m.maps : [];
    for (const mp of maps) {
      const a = Number(mp?.result?.team1 ?? mp?.team1?.result ?? 0);
      const b = Number(mp?.result?.team2 ?? mp?.team2?.result ?? 0);
      if (a > b) scoreA++;
      else if (b > a) scoreB++;
    }
    // Fall back to the top-level result object if maps weren't parseable.
    if (scoreA === 0 && scoreB === 0) {
      scoreA = Number(m?.team1?.result ?? m?.result?.team1 ?? 0);
      scoreB = Number(m?.team2?.result ?? m?.result?.team2 ?? 0);
    }

    const winnerName =
      status === "FINISHED" && scoreA !== scoreB
        ? scoreA > scoreB
          ? m?.team1?.name ?? null
          : m?.team2?.name ?? null
        : null;

    return { scoreA, scoreB, status, winnerName };
  } catch (e) {
    console.warn(`[hltv] getMatch(${hltvId}) failed:`, (e as Error).message);
    return null;
  }
}

// Fetch the logo URL for a single team via HLTV.getTeam. The event-list
// response doesn't include logos, but the team detail endpoint does. We call
// this lazily during sync — only for teams that don't yet have one stored.
export async function fetchTeamLogo(hltvId: number): Promise<string | null> {
  try {
    const t = (await HLTV.getTeam({ id: hltvId })) as any;
    const url: string | undefined = t?.logo ?? t?.image ?? undefined;
    if (typeof url === "string" && url.startsWith("http")) return url;
  } catch (e) {
    console.warn(`[hltv] getTeam(${hltvId}) failed:`, (e as Error).message);
  }
  return null;
}

export async function fetchEventSnapshot(eventId: number): Promise<HltvEventSnapshot> {
  // Every HLTV call can independently get Cloudflare-blocked from cloud IPs.
  // We swallow per-call so one block doesn't kill the whole sync — the
  // per-stage event calls run regardless and the previous DB state stays
  // intact for whatever we couldn't refresh this pass.

  // 1. Event page — has name/dates and the list of attending teams.
  const event = (await safe(
    () => HLTV.getEvent({ id: eventId }) as Promise<any>,
    null as any,
  )) ?? {};

  const teams: HltvTeam[] = (event?.teams ?? []).map((t: any) => ({
    hltvId: Number(t.id ?? t.team?.id ?? 0),
    name: String(t.name ?? t.team?.name ?? "Unknown"),
    logo: t.logo ?? null,
  }));

  // 2. Upcoming matches (filter by event).
  const upcoming = await safe(() => HLTV.getMatches() as Promise<any[]>, [] as any[]);
  const upcomingMatches: HltvMatch[] = (upcoming ?? [])
    .filter((m: any) => Number(m?.event?.id) === eventId)
    .map(normalizeMatch);

  // 3. Results (last ~50 in this event).
  const results = await safe(
    () => HLTV.getResults({ eventIds: [eventId] } as any) as Promise<any[]>,
    [] as any[],
  );
  const resultMatches: HltvMatch[] = (results ?? []).map(normalizeResult);

  return {
    hltvEventId: eventId,
    name: String(event?.name ?? `HLTV Event ${eventId}`),
    startDate: parseDate(event?.dateStart),
    endDate: parseDate(event?.dateEnd),
    teams,
    upcomingMatches,
    resultMatches,
  };
}

// Fetch *just* the matches (upcoming + results) for a stage-specific event ID,
// forcing every returned HltvMatch's stageKind to the kind you pass.
//
// Cologne 2026 splits each Major stage into its own HLTV event:
//   8301 - umbrella       (teams, dates, name)
//   9028 - Stage 1        (results)
//   9029 - Stage 2        (live + results)
//   ...
export async function fetchStageMatches(
  stageEventId: number,
  stageKind: StageKind,
): Promise<HltvMatch[]> {
  const upcoming = await safe(() => HLTV.getMatches() as Promise<any[]>, [] as any[]);
  const upcomingForStage = (upcoming ?? [])
    .filter((m: any) => Number(m?.event?.id) === stageEventId)
    .map(normalizeMatch);

  const results = await safe(
    () => HLTV.getResults({ eventIds: [stageEventId] } as any) as Promise<any[]>,
    [] as any[],
  );
  const resultMatches: HltvMatch[] = (results ?? []).map(normalizeResult);

  // Force the stage kind — HLTV's labels are unreliable enough that we trust
  // the event-id-to-stage mapping the caller passed in.
  const all = [...resultMatches, ...upcomingForStage];
  for (const m of all) m.stageKind = stageKind;
  return all;
}

// --- Internals ---------------------------------------------------------------

function parseDate(d: unknown): Date | null {
  if (!d) return null;
  const n = typeof d === "number" ? d : Date.parse(String(d));
  if (Number.isNaN(n)) return null;
  return new Date(n);
}

function inferStageKind(label: string | null | undefined): StageKind | null {
  if (!label) return null;
  const s = label.toLowerCase();
  // Cologne 2026 onward: Stage 1 / Stage 2 / Stage 3 (all Swiss) + Playoffs.
  if (s.includes("stage 1") || s.includes("stage-1") || s.includes("challenger")) return "STAGE_1";
  if (s.includes("stage 2") || s.includes("stage-2") || s.includes("legends") || s.includes("opening")) return "STAGE_2";
  if (s.includes("stage 3") || s.includes("stage-3") || s.includes("elimination")) return "STAGE_3";
  if (s.includes("playoff") || s.includes("champions") || s.includes("quarter") || s.includes("semi") || s.includes("final"))
    return "PLAYOFFS";
  return null;
}

function inferSwissRound(label: string | null | undefined): number | null {
  if (!label) return null;
  const m = label.match(/round\s+(\d+)/i);
  return m ? Number(m[1]) : null;
}

function inferBracketRound(label: string | null | undefined): number | null {
  if (!label) return null;
  const s = label.toLowerCase();
  if (s.includes("grand final")) return 4;
  if (s.includes("final") && !s.includes("semi") && !s.includes("quarter")) return 3;
  if (s.includes("semi")) return 2;
  if (s.includes("quarter")) return 1;
  return null;
}

function normalizeMatch(m: any): HltvMatch {
  const stageLabel: string | undefined = m?.format?.name ?? m?.stars?.name ?? m?.eventName;
  const aName = m?.team1?.name ?? null;
  const bName = m?.team2?.name ?? null;
  return {
    hltvId: Number(m?.id ?? 0),
    stageKind: inferStageKind(stageLabel),
    swissRound: inferSwissRound(stageLabel),
    bracketRound: inferBracketRound(stageLabel),
    teamAHltvId: Number(m?.team1?.id ?? 0) || null,
    teamBHltvId: Number(m?.team2?.id ?? 0) || null,
    teamAName: aName,
    teamBName: bName,
    teamALogo: m?.team1?.logo ?? null,
    teamBLogo: m?.team2?.logo ?? null,
    scoreA: 0,
    scoreB: 0,
    bestOf: inferBestOf(m?.format?.type ?? m?.format?.name),
    status: m?.live ? "LIVE" : "PENDING",
    startTime: parseDate(m?.date),
    winnerName: null,
  };
}

function normalizeResult(r: any): HltvMatch {
  const stageLabel: string | undefined = r?.event?.name ?? r?.stars?.name ?? r?.format?.name;
  const scoreA = Number(r?.result?.team1 ?? r?.team1?.result ?? 0);
  const scoreB = Number(r?.result?.team2 ?? r?.team2?.result ?? 0);
  const aName: string | null = r?.team1?.name ?? null;
  const bName: string | null = r?.team2?.name ?? null;
  const winnerName = scoreA === scoreB ? null : scoreA > scoreB ? aName : bName;
  return {
    hltvId: Number(r?.id ?? 0),
    stageKind: inferStageKind(stageLabel),
    swissRound: inferSwissRound(stageLabel),
    bracketRound: inferBracketRound(stageLabel),
    teamAHltvId: Number(r?.team1?.id ?? 0) || null,
    teamBHltvId: Number(r?.team2?.id ?? 0) || null,
    teamAName: aName,
    teamBName: bName,
    teamALogo: r?.team1?.logo ?? null,
    teamBLogo: r?.team2?.logo ?? null,
    scoreA,
    scoreB,
    bestOf: scoreA + scoreB <= 1 ? 1 : 3,
    status: "FINISHED",
    startTime: parseDate(r?.date),
    winnerName,
  };
}

function inferBestOf(label: unknown): number {
  if (!label) return 1;
  const s = String(label).toLowerCase();
  if (s.includes("bo5")) return 5;
  if (s.includes("bo3")) return 3;
  return 1;
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.warn("[hltv] swallowed error:", (e as Error).message);
    return fallback;
  }
}
