// Server-side query helpers that produce the `ClientTournament` shape used everywhere.

import { prisma } from "./db";
import type {
  ClientMatch,
  ClientPickem,
  ClientStage,
  ClientTeam,
  ClientTournament,
  PickKind,
  StageKind,
} from "./types";

export async function getActiveTournament(): Promise<ClientTournament | null> {
  // Latest by lastSyncedAt; in practice you'd filter by date.
  const t = await prisma.tournament.findFirst({
    orderBy: { lastSyncedAt: "desc" },
    include: {
      stages: { include: { matches: { include: { teamA: true, teamB: true } } } },
      teams: { include: { team: true } },
    },
  });
  if (!t) return null;

  const stages: ClientStage[] = t.stages.map((s) => {
    const matches: ClientMatch[] = s.matches
      .sort((a, b) => (a.swissRound ?? a.bracketRound ?? 0) - (b.swissRound ?? b.bracketRound ?? 0))
      .map(
        (m): ClientMatch => ({
          id: m.id,
          hltvId: m.hltvId,
          stageKind: s.kind as StageKind,
          swissRound: m.swissRound,
          bracketRound: m.bracketRound,
          bracketSlot: m.bracketSlot,
          teamA: m.teamA ? toTeam(m.teamA) : null,
          teamB: m.teamB ? toTeam(m.teamB) : null,
          scoreA: m.scoreA,
          scoreB: m.scoreB,
          bestOf: m.bestOf,
          status: m.status as ClientMatch["status"],
          startTime: m.startTime?.toISOString() ?? null,
          winnerId: m.winnerId,
        }),
      );

    // Per-stage team roster — dedup by id, sort by name. Each Swiss stage has
    // its own 16-team field that overlaps only partially with adjacent stages.
    const teamMap = new Map<string, ClientTeam>();
    for (const m of matches) {
      if (m.teamA && !teamMap.has(m.teamA.id)) teamMap.set(m.teamA.id, m.teamA);
      if (m.teamB && !teamMap.has(m.teamB.id)) teamMap.set(m.teamB.id, m.teamB);
    }
    const teams = [...teamMap.values()].sort((a, b) => a.name.localeCompare(b.name));

    return {
      id: s.id,
      kind: s.kind as StageKind,
      name: s.name,
      matches,
      teams,
    };
  });

  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    hltvEventId: t.hltvEventId,
    startDate: t.startDate?.toISOString() ?? null,
    endDate: t.endDate?.toISOString() ?? null,
    lastSyncedAt: t.lastSyncedAt?.toISOString() ?? null,
    teams: t.teams.map((tt) => toTeam(tt.team)),
    stages,
  };
}

export async function getUserPickem(
  userId: string,
  tournamentId: string,
): Promise<ClientPickem | null> {
  const p = await prisma.pickem.findUnique({
    where: { userId_tournamentId: { userId, tournamentId } },
    include: { picks: true, user: true },
  });
  if (!p) return null;
  return {
    id: p.id,
    userId: p.userId,
    userName: p.user.name,
    tournamentId: p.tournamentId,
    picks: p.picks.map((pp) => ({
      kind: pp.kind as PickKind,
      stageKind: pp.stageKind as StageKind,
      teamId: pp.teamId,
      round: pp.round,
    })),
  };
}

export async function getAllPickems(tournamentId: string): Promise<ClientPickem[]> {
  const rows = await prisma.pickem.findMany({
    where: { tournamentId },
    include: { picks: true, user: true },
  });
  return rows.map((p) => ({
    id: p.id,
    userId: p.userId,
    userName: p.user.name,
    userImage: p.user.image,
    tournamentId: p.tournamentId,
    picks: p.picks.map((pp) => ({
      kind: pp.kind as PickKind,
      stageKind: pp.stageKind as StageKind,
      teamId: pp.teamId,
      round: pp.round,
    })),
  }));
}

function toTeam(t: { id: string; hltvId: number | null; name: string; logo: string | null }): ClientTeam {
  return { id: t.id, hltvId: t.hltvId, name: t.name, logo: t.logo };
}
