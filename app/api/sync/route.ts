// Vercel Cron hits this endpoint every ~10 minutes (see vercel.json).
// Protected by CRON_SECRET (Vercel automatically attaches Authorization: Bearer $CRON_SECRET).

import { NextRequest, NextResponse } from "next/server";
import { parseStageEvents, syncTournament } from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const eventId = Number(process.env.HLTV_EVENT_ID ?? 0);
  if (!eventId) return NextResponse.json({ error: "HLTV_EVENT_ID not set" }, { status: 400 });

  const stageEvents = parseStageEvents(process.env.HLTV_STAGE_EVENTS);

  try {
    const result = await syncTournament(eventId, stageEvents);
    return NextResponse.json({ ok: true, ...result, syncedAt: new Date().toISOString() });
  } catch (e) {
    console.error("[sync] failed:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// Allow POST too (handy for manual triggers from the UI).
export const POST = GET;
