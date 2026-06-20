// Returns the viewer's accepted friends' picks for the active tournament,
// indexed by teamId so MatchCard can do an O(1) lookup per team-row hover.
//
// Shape:
//   {
//     friends: { id, name, image }[],
//     // teamId -> array of (friendId, kind, round) for that team
//     byTeam: Record<string, Array<{ friendId, kind, round | null }>>
//   }
//
// We cache for 30s — picks are user-edited at human speed; refreshing on
// every nav is wasteful and inflates DB load if a friend is rapidly
// editing. Stale-while-revalidate for the dot UI isn't critical.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadFriendGraph, loadUserSummaries } from "@/lib/friends";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const viewerId = (session?.user as any)?.id as string | undefined;
  if (!viewerId) {
    return NextResponse.json({ friends: [], byTeam: {} });
  }

  const tournament = await prisma.tournament.findFirst({
    orderBy: { lastSyncedAt: "desc" },
    select: { id: true },
  });
  if (!tournament) {
    return NextResponse.json({ friends: [], byTeam: {} });
  }

  const graph = await loadFriendGraph(viewerId);
  const friendIds = [...graph.acceptedIds];
  if (friendIds.length === 0) {
    return NextResponse.json({ friends: [], byTeam: {} });
  }

  // Pull friends' picks for this tournament in one shot. Each pick row is
  // small; even 100 friends with 26 picks each is <3k rows.
  const pickems = await prisma.pickem.findMany({
    where: { tournamentId: tournament.id, userId: { in: friendIds } },
    select: {
      userId: true,
      picks: { select: { teamId: true, kind: true, round: true } },
    },
  });

  const summaries = await loadUserSummaries(friendIds);
  const friends = [...summaries.values()].map((u) => ({
    id: u.id,
    name: u.name,
    image: u.image,
  }));

  const byTeam: Record<
    string,
    Array<{ friendId: string; kind: string; round: number | null }>
  > = {};
  for (const p of pickems) {
    for (const pick of p.picks) {
      (byTeam[pick.teamId] ||= []).push({
        friendId: p.userId,
        kind: pick.kind,
        round: pick.round,
      });
    }
  }

  return NextResponse.json(
    { friends, byTeam },
    {
      headers: {
        "cache-control": "private, max-age=30",
      },
    },
  );
}
