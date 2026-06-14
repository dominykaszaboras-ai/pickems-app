// POST /api/friends/respond   { friendshipId, action: "accept" | "decline" }
// Only the receiver of a PENDING request can respond.
// - accept  -> status = ACCEPTED, respondedAt = now
// - decline -> hard delete the row
//
// Race safety: if the row is gone (requester cancelled, partner unfriended,
// double-click in two tabs), Prisma throws P2025. We treat that as success
// for declines and as 404 for accepts — the outcome the caller wanted is
// already true in either case.

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isSameOrigin } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  friendshipId: z.string().min(1).max(64),
  action: z.enum(["accept", "decline"]),
});

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const session = await auth();
  const viewerId = (session?.user as any)?.id as string | undefined;
  if (!viewerId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { friendshipId, action } = parsed.data;

  const row = await prisma.friendship.findUnique({ where: { id: friendshipId } });
  // Only the receiver of a still-PENDING request can respond. Returning 404
  // instead of 403 here keeps us from leaking the existence of the row to
  // someone who has no business inspecting it.
  if (!row || row.receiverId !== viewerId || row.status !== "PENDING") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    if (action === "accept") {
      const updated = await prisma.friendship.update({
        where: { id: friendshipId },
        data: { status: "ACCEPTED", respondedAt: new Date() },
      });
      return NextResponse.json({ ok: true, status: "friends", friendshipId: updated.id });
    } else {
      await prisma.friendship.delete({ where: { id: friendshipId } });
      return NextResponse.json({ ok: true, status: "none" });
    }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      // Row vanished between our read and write — decline is now trivially
      // true, accept can no longer succeed.
      if (action === "decline") return NextResponse.json({ ok: true, status: "none" });
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    throw e;
  }
}
