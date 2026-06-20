// Playoff bracket auto-progression.
//
// CS2 Major playoffs are an 8-team single-elimination bracket: 4 QFs
// (bracketRound=1, bracketSlot=1..4) → 2 SFs (round=2, slot=1..2) →
// 1 Grand Final (round=3, slot=1). The QFs come in via the regular HLTV
// sync (with manual stage placement, see the lock added in lib/sync.ts).
// The SFs + Final are usually seeded by the daily Liquipedia schedule
// pass with `teamAId=null teamBId=null` placeholders.
//
// This module handles the bracket-progression layer:
//
//   1. If we have 4 QFs in PLAYOFFS but no SF / Final placeholder rows,
//      create them. Future tournaments where Liquipedia hasn't populated
//      yet will get the structure right away.
//   2. For each existing SF / Final row whose teamA or teamB is still
//      null, fill it from the corresponding feeder match's winner — but
//      only if the feeder has FINISHED. Never overwrites a slot that's
//      already populated (so manually-seeded teams or Liquipedia-parsed
//      teams stay intact).
//
// Called at the end of `syncTournament` and `syncLiveMatches` so any
// QF/SF that flips to FINISHED triggers a downstream fill on the same
// cron tick — no separate cron + no manual DB edits.

import { prisma } from "./db";

export interface BracketProgressResult {
  /** Number of placeholder rows created (SF1 / SF2 / Final). */
  created: number;
  /** Number of team slots populated this run. */
  advanced: number;
}

export async function progressPlayoffBracket(
  tournamentId: string,
): Promise<BracketProgressResult> {
  const playoffsStage = await prisma.stage.findFirst({
    where: { tournamentId, kind: "PLAYOFFS" },
    select: { id: true },
  });
  if (!playoffsStage) return { created: 0, advanced: 0 };

  const matches = await prisma.match.findMany({
    where: { stageId: playoffsStage.id },
    select: {
      id: true,
      bracketRound: true,
      bracketSlot: true,
      teamAId: true,
      teamBId: true,
      status: true,
      winnerId: true,
      startTime: true,
    },
  });

  // QFs must all have both teams set and a bracketSlot in 1..4 to feed the
  // SF rows deterministically. Liquipedia-sourced rows sometimes arrive
  // without bracketSlot — those get sorted by startTime as a fallback.
  const qfs = matches
    .filter((m) => m.bracketRound === 1 && m.teamAId && m.teamBId)
    .sort((a, b) => {
      if (a.bracketSlot != null && b.bracketSlot != null) {
        return a.bracketSlot - b.bracketSlot;
      }
      return (a.startTime?.getTime() ?? 0) - (b.startTime?.getTime() ?? 0);
    })
    .slice(0, 4);

  // Without 4 QFs we can't deterministically map feeders → SFs. Bail
  // silently; the next sync will retry once Liquipedia / HLTV catches up.
  if (qfs.length < 4) return { created: 0, advanced: 0 };

  let created = 0;
  let advanced = 0;

  // Idempotent "find or create a placeholder for this bracket slot".
  // bestOf defaults: SF Bo3, Final Bo5 (Cologne 2026 convention; if a
  // different tournament uses Bo5 SFs the operator can override via DB).
  async function ensureRow(round: number, slot: number, bestOf: number) {
    const existing = matches.find(
      (m) => m.bracketRound === round && m.bracketSlot === slot,
    );
    if (existing) return existing;
    const row = await prisma.match.create({
      data: {
        stageId: playoffsStage!.id,
        bracketRound: round,
        bracketSlot: slot,
        bestOf,
        status: "PENDING",
        scoreA: 0,
        scoreB: 0,
      },
      select: {
        id: true,
        bracketRound: true,
        bracketSlot: true,
        teamAId: true,
        teamBId: true,
        status: true,
        winnerId: true,
        startTime: true,
      },
    });
    created++;
    return row;
  }

  const sf1 = await ensureRow(2, 1, 3);
  const sf2 = await ensureRow(2, 2, 3);
  const grandFinal = await ensureRow(3, 1, 5);

  // Fill a target row's teamA / teamB from feeder winners. Only writes a
  // slot that's still null — so a Liquipedia-parsed team name or a manual
  // operator edit is never overwritten.
  async function advance(
    target: { id: string; teamAId: string | null; teamBId: string | null },
    feederA: { status: string; winnerId: string | null },
    feederB: { status: string; winnerId: string | null },
  ) {
    const data: { teamAId?: string; teamBId?: string } = {};
    if (target.teamAId == null && feederA.status === "FINISHED" && feederA.winnerId) {
      data.teamAId = feederA.winnerId;
    }
    if (target.teamBId == null && feederB.status === "FINISHED" && feederB.winnerId) {
      data.teamBId = feederB.winnerId;
    }
    if (Object.keys(data).length === 0) return;
    await prisma.match.update({ where: { id: target.id }, data });
    // Mirror the write back into our local view so cascading reads (e.g.
    // grandFinal feeders that depend on freshly-updated SF teams) see the
    // new values without a second round-trip — except status/winnerId,
    // which only change when the match itself FINISHES.
    if (data.teamAId) target.teamAId = data.teamAId;
    if (data.teamBId) target.teamBId = data.teamBId;
    advanced++;
  }

  await advance(sf1, qfs[0], qfs[1]);
  await advance(sf2, qfs[2], qfs[3]);
  await advance(grandFinal, sf1, sf2);

  return { created, advanced };
}
