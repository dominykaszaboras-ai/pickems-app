// Shared domain types used by client + server.
export type StageKind = "CHALLENGERS" | "LEGENDS" | "CHAMPIONS";

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
