// POST /api/friends/request   { userId }
// Send a friend request to another user. Idempotent for the common cases:
//   - If a row already exists in either direction, we return the current status
//     rather than erroring (lets the UI just re-render the right button state).
//   - If THEY already sent US a pending request, we auto-accept — that's the
//     intuitive "you both added each other" behavior.
//
// Concurrency:
//   - Pair uniqueness is enforced both by Prisma's @@unique([requesterId,
//     receiverId]) AND by a manual unordered-pair index
//     (see prisma/manual-sql/friendship_pair_unique.sql). Concurrent mutual
//     adds (A→B and B→A in the same instant) can't both win — the loser hits
//     a unique-violation we re-read into the current state.
//   - Concurrent same-direction adds: same handling — P2002 → re-read.
//
// Privacy:
//   - Doesn't probe `User.findUnique` first. An invalid receiverId would
//     reveal whether the cuid maps to a real user, which a signed-in
//     attacker could enumerate. Instead we let the FK reject (P2003) and
//     return a generic 400, so "invalid user" and "real user, request sent"
//     are indistinguishable from the response side-channel.

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isSameOrigin, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ userId: z.string().min(1).max(64) });

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const session = await auth();
  const viewerId = (session?.user as any)?.id as string | undefined;
  if (!viewerId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // Per-user anti-spam: 30 friend requests per hour is plenty for real use
  // but stops someone from blasting requests at every account.
  const limit = rateLimit({
    key: `friendreq:${viewerId}`,
    limit: 30,
    windowMs: 60 * 60 * 1000,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many friend requests, slow down" },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSec) } },
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const targetId = parsed.data.userId;

  if (targetId === viewerId) {
    return NextResponse.json({ error: "Cannot friend yourself" }, { status: 400 });
  }

  // Re-read both directions, then dispatch to handler. resolveExisting()
  // is called both pre-create AND after a P2002 race to "absorb" the
  // concurrent insert into the same intended response.
  const resolveExisting = async () => {
    return prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: viewerId, receiverId: targetId },
          { requesterId: targetId, receiverId: viewerId },
        ],
      },
    });
  };

  const handleExisting = async (existing: NonNullable<Awaited<ReturnType<typeof resolveExisting>>>) => {
    if (existing.status === "ACCEPTED") {
      return NextResponse.json({ ok: true, status: "friends", friendshipId: existing.id });
    }
    // PENDING: if they sent it to us, auto-accept (mutual add).
    if (existing.requesterId === targetId) {
      try {
        const updated = await prisma.friendship.update({
          where: { id: existing.id },
          data: { status: "ACCEPTED", respondedAt: new Date() },
        });
        return NextResponse.json({ ok: true, status: "friends", friendshipId: updated.id });
      } catch (e: any) {
        // Row was deleted by the requester between our read + write.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
          // Fall through to a fresh create below.
          return null;
        }
        throw e;
      }
    }
    // PENDING in our direction = request already sent.
    return NextResponse.json({ ok: true, status: "pending_out", friendshipId: existing.id });
  };

  const existing = await resolveExisting();
  if (existing) {
    const res = await handleExisting(existing);
    if (res) return res;
  }

  try {
    const created = await prisma.friendship.create({
      data: { requesterId: viewerId, receiverId: targetId, status: "PENDING" },
    });
    return NextResponse.json({ ok: true, status: "pending_out", friendshipId: created.id });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      // P2002: unique violation — either the same-direction unique or the
      // unordered-pair index fired because of a concurrent insert. Re-read
      // and return whatever is now true.
      if (e.code === "P2002") {
        const after = await resolveExisting();
        if (after) {
          const res = await handleExisting(after);
          if (res) return res;
        }
        // Extremely unlikely: row got created + deleted between our two reads.
        // Fall through to the generic error below.
      }
      // P2003: foreign-key violation (receiverId points at a non-existent
      // user). Return a generic 400 — we deliberately don't distinguish
      // "invalid id" from "row already exists" so callers can't enumerate.
      if (e.code === "P2003") {
        return NextResponse.json({ error: "Invalid request" }, { status: 400 });
      }
    }
    throw e;
  }
  return NextResponse.json({ error: "Invalid request" }, { status: 400 });
}
