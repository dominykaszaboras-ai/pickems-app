// Save / fetch a user's pickem for a given tournament.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isSameOrigin } from "@/lib/rateLimit";
import {
  getTournamentItems,
  getTournamentLayout,
  localPicksToSteam,
  parseSteamLayout,
  uploadTournamentPredictions,
} from "@/lib/steamPickems";
import { normalizeTeamName } from "@/lib/liquipedia";

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
  // Set to false to skip pushing picks to Steam even when the user has
  // Steam + auth code on file. Lets the client honour an opt-out toggle
  // without us needing to persist the preference server-side.
  syncToSteam: z.boolean().optional(),
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

  const { tournamentId, picks, syncToSteam = true } = parsed.data;
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

  // Best-effort push to Steam. Never blocks or fails the local save; we
  // log Valve errors and report them back to the client so the form can
  // show a "saved locally, Steam couldn't be reached" warning if it
  // happens. Eligible when the user has Steam linked AND an auth code
  // on file AND the client didn't explicitly opt out.
  const steamPush = await maybePushToSteam(userId, picks, syncToSteam);

  return NextResponse.json({
    ok: true,
    pickemId: result.id,
    steamPush,
  });
}

interface SteamPushResult {
  attempted: boolean;
  ok: boolean;
  uploaded: number;
  reason?: string;
}

async function maybePushToSteam(
  userId: string,
  picks: Array<{
    kind: "SWISS_3_0" | "SWISS_0_3" | "SWISS_ADVANCE" | "PLAYOFF_WINNER";
    stageKind: "STAGE_1" | "STAGE_2" | "STAGE_3" | "PLAYOFFS";
    teamId: string;
    round?: number | null;
  }>,
  enabled: boolean,
): Promise<SteamPushResult> {
  if (!enabled) {
    return { attempted: false, ok: false, uploaded: 0, reason: "disabled" };
  }
  const eventId = Number(process.env.STEAM_PICKEM_EVENT_ID ?? 0);
  if (!eventId) {
    return { attempted: false, ok: false, uploaded: 0, reason: "no_event_id" };
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { steamId: true, steamPickemCode: true },
  });
  if (!user?.steamId || !user.steamPickemCode) {
    return { attempted: false, ok: false, uploaded: 0, reason: "no_steam_link" };
  }
  if (picks.length === 0) {
    return { attempted: false, ok: false, uploaded: 0, reason: "no_picks" };
  }

  try {
    const layout = await getTournamentLayout(eventId);
    const parsed = parseSteamLayout(layout);

    // Build team-id -> team-name lookup so the reverse mapper can resolve
    // each PickemPick to a Steam pickid.
    const teamIds = Array.from(new Set(picks.map((p) => p.teamId)));
    const teams = await prisma.team.findMany({
      where: { id: { in: teamIds } },
      select: { id: true, name: true },
    });
    const teamNameById = new Map(teams.map((t) => [t.id, t.name]));

    // Fetch the user's per-team sticker itemids — Valve rejects uploads
    // with the wrong itemid (412 Precondition Failed).
    const itemidByTeamid = await getTournamentItems(
      eventId,
      user.steamId,
      user.steamPickemCode,
    );

    const steamPicks = localPicksToSteam(
      parsed,
      picks.map((p) => ({
        kind: p.kind,
        stageKind: p.stageKind,
        teamId: p.teamId,
        round: p.round ?? null,
      })),
      teamNameById,
      normalizeTeamName,
      itemidByTeamid,
    );

    if (steamPicks.length === 0) {
      return {
        attempted: true,
        ok: false,
        uploaded: 0,
        reason: "no_matchable_picks",
      };
    }

    const res = await uploadTournamentPredictions(
      eventId,
      user.steamId,
      user.steamPickemCode,
      steamPicks,
    );
    if (!res.ok) {
      // Empirical error code map (Cologne 2026, verified 2026-06-17):
      //   410 Gone               = stage is concluded; can't update.
      //   412 Precondition Failed = slots already filled (e.g. user
      //                              locked picks via CS2 / counter-
      //                              strike.net); Valve refuses third-
      //                              party overwrite even though the
      //                              section is open for picking.
      //   400 Bad Request        = ambiguous; either the section isn't
      //                              open yet OR we're sending a field
      //                              Valve doesn't recognise.
      const reason =
        res.status === 410
          ? "stage_closed"
          : res.status === 412
            ? "already_picked_in_cs2"
            : res.status === 400
              ? "stage_not_open"
              : `valve_${res.status}`;
      return { attempted: true, ok: false, uploaded: 0, reason };
    }
    return { attempted: true, ok: true, uploaded: steamPicks.length };
  } catch (e) {
    console.error("[pickems-save] steam push threw", e);
    return {
      attempted: true,
      ok: false,
      uploaded: 0,
      reason: "exception",
    };
  }
}
