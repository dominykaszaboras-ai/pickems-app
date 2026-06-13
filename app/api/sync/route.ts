// GitHub Actions cron hits this endpoint every ~10 minutes (see
// .github/workflows/sync.yml). Protected by CRON_SECRET — the workflow
// attaches `Authorization: Bearer $CRON_SECRET`.

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { parseStageEvents, syncTournament } from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Constant-time bearer check. Returns false if the secret env var is
// missing/empty so a misconfigured deploy fails CLOSED instead of letting
// the world trigger syncs at will.
function authorize(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (auth.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(auth), Buffer.from(expected));
  } catch {
    return false;
  }
}

async function handle(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const eventId = Number(process.env.HLTV_EVENT_ID ?? 0);
  if (!eventId) {
    return NextResponse.json({ error: "HLTV_EVENT_ID not set" }, { status: 400 });
  }

  const stageEvents = parseStageEvents(process.env.HLTV_STAGE_EVENTS);

  try {
    const result = await syncTournament(eventId, stageEvents);
    return NextResponse.json({ ok: true, ...result, syncedAt: new Date().toISOString() });
  } catch (e) {
    console.error("[sync] failed:", e);
    // Don't leak internal error messages back to clients.
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
