// POST /api/pickems/sync-steam
//   body: { steamPickemCode: "AAAA-AAAAA-AAAA" }
//
// Calls Valve's ICSGOTournaments_730 endpoints with the user's Major Auth
// Code, then maps the response into our PickemPick rows for the stages
// Steam returned data for. Stages Steam didn't return (e.g. playoffs not
// open yet) are left untouched, so a user can mix HLTV-fed Swiss picks
// with hand-entered playoff picks.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isSameOrigin, rateLimit, clientIp } from "@/lib/rateLimit";
import {
  extractPredictions,
  getTournamentLayout,
  getTournamentPredictions,
  parseSteamLayout,
  steamPicksToLocal,
} from "@/lib/steamPickems";
import { normalizeTeamName } from "@/lib/liquipedia";
import type { StageKind } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  steamPickemCode: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]{4}-[A-Z0-9]{5}-[A-Z0-9]{4}$/i, "Expected format AAAA-AAAAA-AAAA"),
});

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const steamPickemCode = parsed.data.steamPickemCode.toUpperCase();

  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const limit = rateLimit({
    key: `pickems-sync-steam:${userId}:${clientIp(req)}`,
    limit: 6,
    windowMs: 60_000,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many sync attempts — slow down a moment." },
      { status: 429 },
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { steamId: true },
  });
  if (!user?.steamId) {
    return NextResponse.json(
      { error: "Link a Steam account first (you can do that from your profile)." },
      { status: 400 },
    );
  }

  const eventId = Number(process.env.STEAM_PICKEM_EVENT_ID ?? 0);
  if (!eventId) {
    console.error("[sync-steam] STEAM_PICKEM_EVENT_ID not configured");
    return NextResponse.json(
      { error: "This Major isn't configured yet — try again shortly." },
      { status: 503 },
    );
  }

  // 1. Hit Valve (layout is cached process-wide; predictions is per-user).
  let rawLayout: unknown, rawPredictions: unknown;
  try {
    rawLayout = await getTournamentLayout(eventId);
    rawPredictions = await getTournamentPredictions(
      eventId,
      user.steamId,
      steamPickemCode,
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }

  // 2. Persist auth code + payload for debugging.
  await prisma.user.update({
    where: { id: userId },
    data: {
      steamPickemCode,
      steamPickemRaw: JSON.stringify({
        at: new Date().toISOString(),
        layout: rawLayout,
        predictions: rawPredictions,
      }),
    },
  });

  // 3. Map Steam predictions -> local PickemPick rows.
  const predictions = extractPredictions(rawPredictions);
  if (predictions.length === 0) {
    return NextResponse.json({
      ok: true,
      predictionsCount: 0,
      appliedCount: 0,
      stagesApplied: [] as StageKind[],
      note:
        "Steam returned 0 predictions. Either you haven't placed any picks for this Major yet, or there's an event-config mismatch on our side.",
    });
  }

  const hltvEventId = Number(process.env.HLTV_EVENT_ID ?? 0);
  const tournament = hltvEventId
    ? await prisma.tournament.findUnique({ where: { hltvEventId } })
    : await prisma.tournament.findFirst({ orderBy: { startDate: "desc" } });
  if (!tournament) {
    return NextResponse.json(
      { error: "Active tournament not synced yet on our side — try again shortly." },
      { status: 503 },
    );
  }

  // Team lookup scoped to teams that are or were associated with this
  // tournament (umbrella roster OR played any match here). Same loosening
  // we use in /api/pickems for save validation.
  const teams = await prisma.team.findMany({
    where: {
      OR: [
        { tournaments: { some: { tournamentId: tournament.id } } },
        { matchesA: { some: { stage: { tournamentId: tournament.id } } } },
        { matchesB: { some: { stage: { tournamentId: tournament.id } } } },
      ],
    },
    select: { id: true, name: true },
  });
  const teamIdByNormalizedName = new Map(
    teams.map((t) => [normalizeTeamName(t.name), t.id]),
  );

  const layoutParsed = parseSteamLayout(rawLayout);
  const localPicks = steamPicksToLocal(
    layoutParsed,
    predictions,
    teamIdByNormalizedName,
    normalizeTeamName,
  );

  if (localPicks.length === 0) {
    return NextResponse.json({
      ok: true,
      predictionsCount: predictions.length,
      appliedCount: 0,
      stagesApplied: [] as StageKind[],
      note:
        "Pulled predictions from Steam but couldn't match any teams to our database — please report this and we'll investigate.",
    });
  }

  const stagesApplied = [...new Set(localPicks.map((p) => p.stageKind))];

  // 4. Replace user's picks ONLY for the stages we got from Steam. This
  //    preserves anything they entered locally for stages Steam doesn't
  //    have (e.g. playoffs not open yet).
  await prisma.$transaction(async (tx) => {
    const pickem = await tx.pickem.upsert({
      where: { userId_tournamentId: { userId, tournamentId: tournament.id } },
      update: {},
      create: { userId, tournamentId: tournament.id },
    });
    await tx.pickemPick.deleteMany({
      where: { pickemId: pickem.id, stageKind: { in: stagesApplied } },
    });
    await tx.pickemPick.createMany({
      data: localPicks.map((p) => ({
        pickemId: pickem.id,
        kind: p.kind,
        stageKind: p.stageKind,
        teamId: p.teamId,
        round: p.round,
      })),
    });
  });

  return NextResponse.json({
    ok: true,
    predictionsCount: predictions.length,
    appliedCount: localPicks.length,
    stagesApplied,
    note: `Applied ${localPicks.length} pick(s) across ${stagesApplied.length} stage(s). Refresh the form below to see them.`,
  });
}
