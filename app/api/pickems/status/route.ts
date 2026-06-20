// Lightweight signal for the Nav: does the signed-in viewer have any
// open stage on the active tournament with no picks submitted yet?
//
// "Open" means the stage has at least one PENDING match that hasn't
// started yet (within a 30-min grace window for matches just-started).
// We return one boolean + an optional stage label so the Nav can render
// a dot + accessible label, without leaking the full pick state.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { STAGE_LABEL, type StageKind } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ needsPicks: false });
  }

  // Active tournament = the one most recently synced.
  const tournament = await prisma.tournament.findFirst({
    orderBy: { lastSyncedAt: "desc" },
    include: {
      stages: {
        include: {
          matches: { select: { status: true, startTime: true } },
        },
      },
    },
  });
  if (!tournament) return NextResponse.json({ needsPicks: false });

  const pickem = await prisma.pickem.findUnique({
    where: { userId_tournamentId: { userId, tournamentId: tournament.id } },
    include: { picks: { select: { stageKind: true } } },
  });
  const stagesWithPicks = new Set(
    (pickem?.picks ?? []).map((p) => p.stageKind as StageKind),
  );

  const STAGE_RANK: Record<StageKind, number> = {
    STAGE_1: 1,
    STAGE_2: 2,
    STAGE_3: 3,
    PLAYOFFS: 4,
  };

  // A stage is "open for picks" iff at least one of its matches is still
  // upcoming. We add a 30-min grace so a stage that started 5min ago is
  // already counted as "locked" — beyond that it's just nag fatigue.
  const lockCutoff = Date.now() - 30 * 60 * 1000;
  const openStages = tournament.stages
    .filter((s) => {
      const hasUpcoming = s.matches.some((m) => {
        if (m.status !== "PENDING") return false;
        if (!m.startTime) return true;
        return m.startTime.getTime() > lockCutoff;
      });
      return hasUpcoming;
    })
    .sort(
      (a, b) =>
        (STAGE_RANK[a.kind as StageKind] ?? 0) -
        (STAGE_RANK[b.kind as StageKind] ?? 0),
    );

  const firstOpenMissing = openStages.find(
    (s) => !stagesWithPicks.has(s.kind as StageKind),
  );

  if (!firstOpenMissing) {
    return NextResponse.json({ needsPicks: false });
  }
  return NextResponse.json({
    needsPicks: true,
    stage: STAGE_LABEL[firstOpenMissing.kind as StageKind],
  });
}
