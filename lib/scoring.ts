// Pickems scoring engine.
//
// Standard Valve format:
//  Swiss stages (Challengers + Legends), 16 teams, 5 rounds:
//    - 1 point per correct "advance" pick (i.e. team you said would qualify did qualify)
//    - +4 bonus if your 3-0 pick actually goes 3-0
//    - +4 bonus if your 0-3 pick actually goes 0-3
//  Champions playoffs (8 teams, single-elim):
//    - 1 point per correct QF winner
//    - 2 points per correct SF winner
//    - 4 points per correct GF winner (the champion)
//
// All functions are pure: they take stages + matches + picks (+ optional
// simulated winner overrides) and return a deterministic score breakdown.
// This means the bracket page can run the same logic client-side to live-update
// scores when the user simulates outcomes.

import {
  emptyByStage,
  type ClientMatch,
  type ClientPickem,
  type ClientStage,
  type ClientTournament,
  type PickKind,
  type StageKind,
  type SwissStanding,
} from "./types";

// Override: matchId -> winning teamId (used by the simulation UI).
export type WinnerOverrides = Record<string, string | null>;

export interface ScoreLine {
  total: number;
  byStage: Record<StageKind, number>;
  // Per-pick correctness, useful for the UI highlight.
  pickResults: Array<{
    kind: PickKind;
    stageKind: StageKind;
    teamId: string;
    round: number | null;
    points: number;
    correct: boolean | null; // null = stage not concluded yet
  }>;
}

export function effectiveWinner(match: ClientMatch, overrides: WinnerOverrides): string | null {
  if (overrides[match.id] !== undefined) return overrides[match.id];
  return match.winnerId;
}

// Compute per-team standings within a swiss stage given current/overridden winners.
export function computeSwissStandings(stage: ClientStage, overrides: WinnerOverrides): Map<string, SwissStanding> {
  const standings = new Map<string, SwissStanding>();

  // Seed every team that appears in any swiss match.
  for (const m of stage.matches) {
    for (const t of [m.teamA, m.teamB]) {
      if (t && !standings.has(t.id)) {
        standings.set(t.id, { teamId: t.id, wins: 0, losses: 0, status: "ACTIVE", outcome: null });
      }
    }
  }

  for (const m of stage.matches) {
    const w = effectiveWinner(m, overrides);
    if (!w || !m.teamA || !m.teamB) continue;
    const loserId = w === m.teamA.id ? m.teamB.id : m.teamA.id;
    const ws = standings.get(w);
    const ls = standings.get(loserId);
    if (ws) ws.wins += 1;
    if (ls) ls.losses += 1;
  }

  for (const s of standings.values()) {
    if (s.wins >= 3) {
      s.status = "ADVANCED";
      if (s.losses === 0) s.outcome = "QUALIFIED_3_0";
    } else if (s.losses >= 3) {
      s.status = "ELIMINATED";
      if (s.wins === 0) s.outcome = "ELIM_0_3";
    } else {
      s.status = "ACTIVE";
    }
  }
  return standings;
}

// Determine whether the stage is fully concluded (each team is 3-x or x-3).
export function isStageConcluded(standings: Map<string, SwissStanding>): boolean {
  for (const s of standings.values()) {
    if (s.status === "ACTIVE") return false;
  }
  return standings.size > 0;
}

// Score one swiss stage for a single pickem.
function scoreSwissStage(
  stage: ClientStage,
  pickem: ClientPickem,
  overrides: WinnerOverrides,
  out: ScoreLine,
) {
  const standings = computeSwissStandings(stage, overrides);
  const concluded = isStageConcluded(standings);

  for (const pick of pickem.picks) {
    if (pick.stageKind !== stage.kind) continue;
    const s = standings.get(pick.teamId);
    let points = 0;
    let correct: boolean | null = null;

    if (pick.kind === "SWISS_ADVANCE") {
      // An ADVANCE pick is correct only if the team finishes 3-1 or 3-2 —
      // i.e. advanced *without* a 3-0 run. A 3-0 team only satisfies the
      // SWISS_3_0 pick and is wrong as an ADVANCE pick.
      if (s?.status === "ADVANCED" && s.losses >= 1) {
        points = 1;
        correct = true;
      } else if (s?.status === "ADVANCED" && s.losses === 0) {
        // 3-0 — wrong for an advance pick.
        correct = false;
      } else if (s?.status === "ELIMINATED") {
        correct = false;
      } else if (!concluded) {
        correct = null;
      }
    } else if (pick.kind === "SWISS_3_0") {
      if (s?.outcome === "QUALIFIED_3_0") {
        points = 4;
        correct = true;
      } else if (s?.status === "ADVANCED" || s?.status === "ELIMINATED") {
        correct = false;
      }
    } else if (pick.kind === "SWISS_0_3") {
      if (s?.outcome === "ELIM_0_3") {
        points = 4;
        correct = true;
      } else if (s?.status === "ADVANCED" || s?.status === "ELIMINATED") {
        correct = false;
      }
    }

    out.byStage[stage.kind] += points;
    out.total += points;
    out.pickResults.push({
      kind: pick.kind,
      stageKind: stage.kind,
      teamId: pick.teamId,
      round: pick.round,
      points,
      correct,
    });
  }
}

// Walk the playoff bracket round-by-round, given current matches + overrides,
// and score the user's PLAYOFF_WINNER picks.
function scorePlayoffs(
  stage: ClientStage,
  pickem: ClientPickem,
  overrides: WinnerOverrides,
  out: ScoreLine,
) {
  // No-op outside the playoffs stage.
  if (stage.kind !== "PLAYOFFS") return;
  // Group matches by bracketRound.
  const rounds: Record<number, ClientMatch[]> = {};
  for (const m of stage.matches) {
    const r = m.bracketRound ?? 0;
    if (!rounds[r]) rounds[r] = [];
    rounds[r].push(m);
  }

  // Collect the set of winners that actually emerged from each round.
  const winnersByRound: Record<number, Set<string>> = {};
  for (const [r, ms] of Object.entries(rounds)) {
    const round = Number(r);
    winnersByRound[round] = new Set();
    for (const m of ms) {
      const w = effectiveWinner(m, overrides);
      if (w) winnersByRound[round].add(w);
    }
  }

  // Points per round: QF=1, SF=2, F=4, Champion (round=4) = +4 bonus.
  const pointsForRound: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 4 };

  for (const pick of pickem.picks) {
    if (pick.stageKind !== "PLAYOFFS" || pick.kind !== "PLAYOFF_WINNER") continue;
    const r = pick.round ?? 0;
    const ms = rounds[r] ?? [];
    const allDone = ms.length > 0 && ms.every((m) => effectiveWinner(m, overrides) !== null);

    let points = 0;
    let correct: boolean | null = null;
    const wonRound = winnersByRound[r]?.has(pick.teamId) ?? false;

    if (wonRound) {
      points = pointsForRound[r] ?? 0;
      correct = true;
    } else if (allDone) {
      // The team you picked did not win that round.
      // We also want to detect "the team wasn't even in this round" as wrong.
      correct = false;
    }

    out.byStage.PLAYOFFS += points;
    out.total += points;
    out.pickResults.push({
      kind: pick.kind,
      stageKind: "PLAYOFFS",
      teamId: pick.teamId,
      round: pick.round,
      points,
      correct,
    });
  }
}

export function scorePickem(
  tournament: ClientTournament,
  pickem: ClientPickem,
  overrides: WinnerOverrides = {},
): ScoreLine {
  const out: ScoreLine = {
    total: 0,
    byStage: emptyByStage(),
    pickResults: [],
  };
  for (const stage of tournament.stages) {
    if (stage.kind === "PLAYOFFS") scorePlayoffs(stage, pickem, overrides, out);
    else scoreSwissStage(stage, pickem, overrides, out);
  }
  return out;
}
