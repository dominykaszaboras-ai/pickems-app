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
  teamAHltvId: number | null;
  teamBHltvId: number | null;
  teamAName: string | null;
  teamBName: string | null;
  scoreA: number;
  scoreB: number;
  bestOf: number;
  // PENDING | LIVE | FINISHED
  status: "PENDING" | "LIVE" | "FINISHED";
  startTime: Date | null;
  winnerHltvId: number | null;
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

export async function fetchEventSnapshot(eventId: number): Promise<HltvEventSnapshot> {
  // 1. Event page — has name/dates and the list of attending teams.
  const event = (await HLTV.getEvent({ id: eventId })) as any;

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
  return {
    hltvId: Number(m?.id ?? 0),
    stageKind: inferStageKind(stageLabel),
    swissRound: inferSwissRound(stageLabel),
    bracketRound: inferBracketRound(stageLabel),
    teamAHltvId: Number(m?.team1?.id ?? 0) || null,
    teamBHltvId: Number(m?.team2?.id ?? 0) || null,
    teamAName: m?.team1?.name ?? null,
    teamBName: m?.team2?.name ?? null,
    scoreA: 0,
    scoreB: 0,
    bestOf: inferBestOf(m?.format?.type ?? m?.format?.name),
    status: m?.live ? "LIVE" : "PENDING",
    startTime: parseDate(m?.date),
    winnerHltvId: null,
  };
}

function normalizeResult(r: any): HltvMatch {
  const stageLabel: string | undefined = r?.event?.name ?? r?.stars?.name ?? r?.format?.name;
  const scoreA = Number(r?.result?.team1 ?? r?.team1?.result ?? 0);
  const scoreB = Number(r?.result?.team2 ?? r?.team2?.result ?? 0);
  const t1 = Number(r?.team1?.id ?? 0) || null;
  const t2 = Number(r?.team2?.id ?? 0) || null;
  const winnerHltvId = scoreA === scoreB ? null : scoreA > scoreB ? t1 : t2;
  return {
    hltvId: Number(r?.id ?? 0),
    stageKind: inferStageKind(stageLabel),
    swissRound: inferSwissRound(stageLabel),
    bracketRound: inferBracketRound(stageLabel),
    teamAHltvId: t1,
    teamBHltvId: t2,
    teamAName: r?.team1?.name ?? null,
    teamBName: r?.team2?.name ?? null,
    scoreA,
    scoreB,
    bestOf: scoreA + scoreB <= 1 ? 1 : 3,
    status: "FINISHED",
    startTime: parseDate(r?.date),
    winnerHltvId,
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
