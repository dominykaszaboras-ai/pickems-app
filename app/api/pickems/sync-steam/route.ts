// POST /api/pickems/sync-steam
//   body: { steamPickemCode: "AAAA-AAAAA-AAAA", eventId?: number }
//
// Calls Valve's ICSGOTournaments_730 endpoints on the user's behalf using
// their Major Auth Code, stores the raw JSON for debugging, and emits a
// best-effort mapping into our PickemPick rows.
//
// The exact section/group/pick numbering Valve uses changes each Major and
// isn't published; we keep the raw response on the User row so we can refine
// the mapping in code without losing data.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  extractPredictions,
  getTournamentLayout,
  getTournamentPredictions,
} from "@/lib/steamPickems";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  steamPickemCode: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]{4}-[A-Z0-9]{5}-[A-Z0-9]{4}$/i, "Expected format AAAA-AAAAA-AAAA"),
  eventId: z.number().int().positive().optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.steamId) {
    return NextResponse.json(
      { error: "You must be signed in with Steam to sync pickems" },
      { status: 400 },
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const eventId =
    parsed.data.eventId ?? Number(process.env.STEAM_PICKEM_EVENT_ID ?? 0);
  if (!eventId) {
    return NextResponse.json(
      { error: "Steam event ID not configured. Set STEAM_PICKEM_EVENT_ID or pass eventId." },
      { status: 400 },
    );
  }

  const steamPickemCode = parsed.data.steamPickemCode.toUpperCase();

  // 1. Talk to Valve.
  let rawLayout: unknown, rawPredictions: unknown;
  try {
    rawLayout = await getTournamentLayout(eventId);
    rawPredictions = await getTournamentPredictions(eventId, user.steamId, steamPickemCode);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }

  // 2. Persist the code + raw payload for debugging.
  await prisma.user.update({
    where: { id: userId },
    data: {
      steamPickemCode,
      steamPickemRaw: JSON.stringify({ layout: rawLayout, predictions: rawPredictions }),
    },
  });

  const predictions = extractPredictions(rawPredictions);

  // 3. Reply with the raw Valve data so the client can render it; mapping
  //    into our PickemPick rows lives in /api/pickems/apply-steam after we
  //    confirm the section/group/pick numbering for this Major.
  return NextResponse.json({
    ok: true,
    eventId,
    steamId: user.steamId,
    predictionsCount: predictions.length,
    predictions,
    layout: rawLayout,
    note:
      predictions.length > 0
        ? "Saved. Mapping to local pickems will follow in a second step."
        : "Steam returned 0 predictions. Either you haven't submitted any picks for this event yet, or the eventId is wrong for this Major.",
  });
}
