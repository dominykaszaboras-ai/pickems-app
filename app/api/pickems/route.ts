// Save / fetch a user's pickem for a given tournament.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isSameOrigin } from "@/lib/rateLimit";

export const runtime = "nodejs";

const PickSchema = z.object({
  kind: z.enum(["SWISS_3_0", "SWISS_0_3", "SWISS_ADVANCE", "PLAYOFF_WINNER"]),
  // Keep in sync with StageKind in lib/types.ts.
  stageKind: z.enum(["STAGE_1", "STAGE_2", "STAGE_3", "PLAYOFFS"]),
  teamId: z.string().min(1).max(64),
  round: z.number().int().min(1).max(10).nullable().optional(),
});

const Body = z.object({
  tournamentId: z.string().min(1).max(64),
  picks: z.array(PickSchema).max(200),
});

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const { tournamentId, picks } = parsed.data;
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } });
  if (!tournament) return NextResponse.json({ error: "Tournament not found" }, { status: 404 });

  // Lock check: once start date passes, no more edits (in real Valve format,
  // each stage locks independently — simplified here).
  if (tournament.startDate && tournament.startDate.getTime() < Date.now()) {
    const existing = await prisma.pickem.findUnique({
      where: { userId_tournamentId: { userId, tournamentId } },
    });
    if (existing?.lockedAt) {
      return NextResponse.json({ error: "Pickems are locked" }, { status: 423 });
    }
  }

  // Validate teamId values against teams that have ever been associated with
  // this tournament. "Associated" means either currently on the umbrella
  // roster (TournamentTeam) OR has played at least one match in any of the
  // tournament's stages. The latter matters for Major formats where HLTV's
  // umbrella event roster shrinks as teams are eliminated — without it, a
  // pickem save would reject perfectly valid Stage 1 / Stage 2 picks for
  // teams no longer listed on the umbrella event.
  const submittedTeamIds = Array.from(new Set(picks.map((p) => p.teamId)));
  if (submittedTeamIds.length > 0) {
    const allowed = await prisma.team.findMany({
      where: {
        id: { in: submittedTeamIds },
        OR: [
          { tournaments: { some: { tournamentId } } },
          { matchesA: { some: { stage: { tournamentId } } } },
          { matchesB: { some: { stage: { tournamentId } } } },
        ],
      },
      select: { id: true },
    });
    const allowedSet = new Set(allowed.map((t) => t.id));
    const unknown = submittedTeamIds.filter((id) => !allowedSet.has(id));
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: "Pick references team(s) not in this tournament" },
        { status: 400 },
      );
    }
  }

  // Replace picks transactionally.
  const result = await prisma.$transaction(async (tx) => {
    const pickem = await tx.pickem.upsert({
      where: { userId_tournamentId: { userId, tournamentId } },
      update: {},
      create: { userId, tournamentId },
    });
    await tx.pickemPick.deleteMany({ where: { pickemId: pickem.id } });
    if (picks.length > 0) {
      await tx.pickemPick.createMany({
        data: picks.map((p) => ({
          pickemId: pickem.id,
          kind: p.kind,
          stageKind: p.stageKind,
          teamId: p.teamId,
          round: p.round ?? null,
        })),
      });
    }
    return pickem;
  });

  return NextResponse.json({ ok: true, pickemId: result.id });
}
