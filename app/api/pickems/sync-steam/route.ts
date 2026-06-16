// POST /api/pickems/sync-steam
//   body: { steamPickemCode: "AAAA-AAAAA-AAAA" }
//
// Calls Valve's ICSGOTournaments_730 endpoints on the user's behalf using
// their Major Auth Code, stores the raw JSON for debugging, and returns
// a count to the client.
//
// MAPPING to our PickemPick rows is intentionally a follow-up — Valve's
// section/group/pickid numbering is undocumented and changes per major,
// so we want to see real prod responses before committing to a mapping.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isSameOrigin, rateLimit, clientIp } from "@/lib/rateLimit";
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
});

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 1. Validate body shape FIRST — cheap, no DB / Valve calls.
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const steamPickemCode = parsed.data.steamPickemCode.toUpperCase();

  // 2. AuthN.
  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // 3. Per-(user, IP) throttle. The lib also has a process-wide budget on
  //    outbound Valve calls; this one stops an individual abuser earlier.
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

  // 4. Ensure user has a linked SteamID.
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

  // 5. Server-pinned event id — NEVER take this from the client to prevent
  //    using us as a free per-event probe against Valve.
  const eventId = Number(process.env.STEAM_PICKEM_EVENT_ID ?? 0);
  if (!eventId) {
    console.error("[sync-steam] STEAM_PICKEM_EVENT_ID not configured");
    return NextResponse.json(
      { error: "This Major isn't configured yet — try again shortly." },
      { status: 503 },
    );
  }

  // 6. Talk to Valve. Layout is cached process-wide so this is normally
  //    one outbound call per request after warm-up.
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

  // 7. Persist auth code + payload. We store layout alongside predictions
  //    even though it's shared — the per-user snapshot is the debug source
  //    of truth ("what did Valve return for THIS user on THIS day").
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

  const predictions = extractPredictions(rawPredictions);

  // 8. Reply with summary only. Until we map predictions into PickemPick
  //    rows we have no need to ship the array over the wire.
  return NextResponse.json({
    ok: true,
    predictionsCount: predictions.length,
    note:
      predictions.length > 0
        ? "Saved your auth code + Valve's response. Auto-applying picks to the form below is the next step."
        : "Steam returned 0 predictions. Either you haven't submitted picks for this Major yet, or the event configuration is off — ping the operator.",
  });
}
