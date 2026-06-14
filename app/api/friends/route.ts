// GET /api/friends
// Returns the viewer's accepted friends + pending requests in both directions.
// Public profile fields only (id, name, image). Used by /friends page + Nav badge.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isSameOrigin } from "@/lib/rateLimit";
import { loadFriendGraph, loadUserSummaries } from "@/lib/friends";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const session = await auth();
  const viewerId = (session?.user as any)?.id as string | undefined;
  if (!viewerId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const graph = await loadFriendGraph(viewerId);
  const allIds = [
    ...graph.acceptedIds,
    ...graph.pendingOutIds,
    ...graph.pendingInIds,
  ];
  const users = await loadUserSummaries(allIds);

  const project = (id: string) => {
    const u = users.get(id);
    return {
      id,
      name: u?.name ?? null,
      image: u?.image ?? null,
      friendshipId: graph.friendshipIdByOther.get(id) ?? null,
    };
  };

  return NextResponse.json({
    friends: [...graph.acceptedIds].map(project),
    pendingIn: [...graph.pendingInIds].map(project),
    pendingOut: [...graph.pendingOutIds].map(project),
  });
}
