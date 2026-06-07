// Shared domain types used by client + server.
//
// Cologne 2026 format: three Swiss stages + a single-elim playoff bracket.
// (Previous Majors used CHALLENGERS / LEGENDS / CHAMPIONS — the new names
// reflect Valve's renamed structure.)
export type StageKind = "STAGE_1" | "STAGE_2" | "STAGE_3" | "PLAYOFFS";

// Convenience subsets.
export const SWISS_STAGE_KINDS: StageKind[] = ["STAGE_1", "STAGE_2", "STAGE_3"];

export const STAGE_LABEL: Record<StageKind, string> = {
  STAGE_1: "Stage 1",
  STAGE_2: "Stage 2",
  STAGE_3: "Stage 3",
  PLAYOFFS: "Playoffs",
};

export type PickKind =
  | "SWISS_3_0"
  | "SWISS_0_3"
  | "SWISS_ADVANCE"
  | "PLAYOFF_WINNER";

export type MatchStatus = "PENDING" | "LIVE" | "FINISHED";

export interface ClientTeam {
  id: string;
  hltvId: number;
  name: string;
  logo: string | null;
}

export interface ClientMatch {
  id: string;
  hltvId: number | null;
  stageKind: StageKind;
  swissRound: number | null;
  bracketRound: number | null;
  bracketSlot: number | null;
  teamA: ClientTeam | null;
  teamB: ClientTeam | null;
  scoreA: number;
  scoreB: number;
  bestOf: number;
  status: MatchStatus;
  startTime: string | null;
  winnerId: string | null;
}

export interface ClientStage {
  id: string;
  kind: StageKind;
  name: string;
  matches: ClientMatch[];
  // Teams that actually played in (or are slotted for) this stage — derived
  // from match rosters at query time. Use this when rendering pick pools,
  // standings, etc. — NOT the umbrella tournament.teams, which is the union
  // of every stage and contains teams that don't belong here.
  teams: ClientTeam[];
}

export interface ClientTournament {
  id: string;
  name: string;
  slug: string;
  hltvEventId: number;
  startDate: string | null;
  endDate: string | null;
  lastSyncedAt: string | null;
  teams: ClientTeam[];
  stages: ClientStage[];
}

export interface ClientPickemPick {
  kind: PickKind;
  stageKind: StageKind;
  teamId: string;
  round: number | null;
}

export interface ClientPickem {
  id: string;
  userId: string;
  userName: string | null;
  tournamentId: string;
  picks: ClientPickemPick[];
}

// Empty byStage record, useful as an accumulator init.
export function emptyByStage(): Record<StageKind, number> {
  return { STAGE_1: 0, STAGE_2: 0, STAGE_3: 0, PLAYOFFS: 0 };
}

// Stage-level computed standings for swiss
export interface SwissStanding {
  teamId: string;
  wins: number;
  losses: number;
  // ELIMINATED | ADVANCED | ACTIVE
  status: "ELIMINATED" | "ADVANCED" | "ACTIVE";
  // QUALIFIED_3_0 | ELIM_0_3 if applicable
  outcome?: "QUALIFIED_3_0" | "ELIM_0_3" | null;
}

// Playoff bracket projection: which team is in which slot per round
// roundSlots[round][slot] = teamId | null
export interface PlayoffProjection {
  roundSlots: Record<number, (string | null)[]>;
}
