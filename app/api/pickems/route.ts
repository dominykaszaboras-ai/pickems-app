// Save / fetch a user's pickem for a given tournament.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const PickSchema = z.object({
  kind: z.enum(["SWISS_3_0", "SWISS_0_3", "SWISS_ADVANCE", "PLAYOFF_WINNER"]),
  // Keep in sync with StageKind in lib/types.ts.
  stageKind: z.enum(["STAGE_1", "STAGE_2", "STAGE_3", "PLAYOFFS"]),
  teamId: z.string().min(1),
  round: z.number().int().nullable().optional(),
});

const Body = z.object({
  tournamentId: z.string().min(1),
  picks: z.array(PickSchema).max(200),
});

export async function POST(req: NextRequest) {
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
