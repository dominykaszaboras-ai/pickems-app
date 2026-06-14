// DELETE /api/friends/[id]
// Unfriend (when status=ACCEPTED) or cancel an outgoing pending request.
// Either party of the friendship can call this; the receiver of a PENDING
// request should use /api/friends/respond with action="decline" instead but
// this also works.
//
// Race safety: a P2025 from a concurrent delete is just "already gone"
// from the caller's perspective — return ok so the UI stays consistent.

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isSameOrigin } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const session = await auth();
  const viewerId = (session?.user as any)?.id as string | undefined;
  if (!viewerId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const id = params.id;
  if (!id || id.length > 64) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const row = await prisma.friendship.findUnique({ where: { id } });
  // 404 on "not yours" too — don't confirm existence to non-participants.
  if (!row || (row.requesterId !== viewerId && row.receiverId !== viewerId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await prisma.friendship.delete({ where: { id } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      // Already deleted by a concurrent request — caller's intent is satisfied.
      return NextResponse.json({ ok: true });
    }
    throw e;
  }
  return NextResponse.json({ ok: true });
}
