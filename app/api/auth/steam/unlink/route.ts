// Detach the SteamID from the current user.
//
// Refused if the user has no other way to sign back in (no email +
// passwordHash) — otherwise they'd lock themselves out of the account
// the moment their JWT expires. Email-only users can unlink freely;
// Steam-only users can't unlink at all.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isSameOrigin, rateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const session = await auth();
  const viewerId = (session?.user as any)?.id as string | undefined;
  if (!viewerId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Tiny per-user throttle so a runaway client can't churn the row.
  const limit = rateLimit({
    key: `steam-unlink:${viewerId}:${clientIp(req)}`,
    limit: 5,
    windowMs: 60_000,
  });
  if (!limit.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const me = await prisma.user.findUnique({
    where: { id: viewerId },
    select: { steamId: true, email: true, passwordHash: true },
  });
  if (!me) {
    return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  }
  if (!me.steamId) {
    return NextResponse.json({ error: "not_linked" }, { status: 400 });
  }
  if (!me.email || !me.passwordHash) {
    // Only sign-in method is Steam — refusing to unlink so the user
    // doesn't lock themselves out.
    return NextResponse.json(
      { error: "no_fallback_credential" },
      { status: 400 },
    );
  }

  await prisma.user.update({
    where: { id: viewerId },
    data: { steamId: null },
  });

  return NextResponse.json({ ok: true });
}
