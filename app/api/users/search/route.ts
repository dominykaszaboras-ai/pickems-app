// GET /api/users/search?q=foo
// Find users by display name (case-insensitive substring).
//
// Privacy posture:
//   - Signed-in only (no anonymous scraping).
//   - 3-character minimum on `q` so we never dump the user list.
//   - Max 10 results per call.
//   - Same-origin gate even though it's a GET — we don't want third-party
//     pages embedding this endpoint to harvest user data.
//   - Per-user rate limit so a chatty client can't enumerate by paging
//     through every 3-letter combination.
//
// Each result is annotated with the viewer's friend status with that user
// so the UI can render the right "Add" / "Pending" / "Friends ✓" button
// without a second round-trip.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isSameOrigin, rateLimit } from "@/lib/rateLimit";
import { loadFriendGraph, statusOf } from "@/lib/friends";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_RESULTS = 10;
const MIN_Q = 3;
const MAX_Q = 40;

export async function GET(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const session = await auth();
  const viewerId = (session?.user as any)?.id as string | undefined;
  if (!viewerId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const limit = rateLimit({
    key: `usersearch:${viewerId}`,
    limit: 30,
    windowMs: 60 * 1000, // 30 queries per minute per user
  });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Slow down" },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSec) } },
    );
  }

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < MIN_Q || q.length > MAX_Q) {
    return NextResponse.json({ results: [] });
  }

  // Case-insensitive substring search. Postgres `contains` with `mode:"insensitive"`
  // uses ILIKE internally — fine at our scale (a few hundred users).
  const users = await prisma.user.findMany({
    where: {
      name: { contains: q, mode: "insensitive" },
      // Exclude users with no name (incomplete records) so we don't surface
      // ghost rows. Self is filterable on the client.
      NOT: { name: null },
    },
    select: { id: true, name: true, image: true },
    take: MAX_RESULTS,
    orderBy: { name: "asc" },
  });

  const graph = await loadFriendGraph(viewerId);
  const results = users.map((u) => ({
    id: u.id,
    name: u.name,
    image: u.image,
    status: statusOf(graph, viewerId, u.id),
  }));

  return NextResponse.json({ results });
}
