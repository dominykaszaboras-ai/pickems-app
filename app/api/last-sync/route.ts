// Lightweight polling endpoint: returns the active tournament's lastSyncedAt
// timestamp so the Refresh button can detect when fresh data lands.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const t = await prisma.tournament.findFirst({
    orderBy: { lastSyncedAt: "desc" },
    select: { lastSyncedAt: true, name: true },
  });
  return NextResponse.json({
    lastSyncedAt: t?.lastSyncedAt?.toISOString() ?? null,
    name: t?.name ?? null,
  });
}
