// Friendship helpers (server-side).
//
// Friendship model semantics:
//   - PENDING:  requesterId asked receiverId; only the receiver can accept.
//   - ACCEPTED: both sides see each other in their friends list.
//   - Decline / unfriend = hard delete the row, so the pair can re-request later.
//
// `loadFriendGraph` returns the viewer's accepted friend ids + the pending in/out
// sets in a single round-trip, with stable shapes for the UI to consume.

import { prisma } from "./db";

export type FriendStatus = "self" | "friends" | "pending_out" | "pending_in" | "none";

export interface FriendUserSummary {
  id: string;
  name: string | null;
  image: string | null;
}

export interface FriendGraph {
  acceptedIds: Set<string>;
  pendingOutIds: Set<string>;   // they haven't responded to me yet
  pendingInIds: Set<string>;    // they asked me; I haven't responded
  // Friendship.id keyed by the other user's id, for the unfriend endpoint.
  friendshipIdByOther: Map<string, string>;
}

export async function loadFriendGraph(userId: string): Promise<FriendGraph> {
  const rows = await prisma.friendship.findMany({
    where: { OR: [{ requesterId: userId }, { receiverId: userId }] },
    select: {
      id: true,
      status: true,
      requesterId: true,
      receiverId: true,
    },
  });
  const accepted = new Set<string>();
  const pendingOut = new Set<string>();
  const pendingIn = new Set<string>();
  const idByOther = new Map<string, string>();
  for (const r of rows) {
    const other = r.requesterId === userId ? r.receiverId : r.requesterId;
    idByOther.set(other, r.id);
    if (r.status === "ACCEPTED") {
      accepted.add(other);
    } else if (r.status === "PENDING") {
      if (r.requesterId === userId) pendingOut.add(other);
      else pendingIn.add(other);
    }
  }
  return {
    acceptedIds: accepted,
    pendingOutIds: pendingOut,
    pendingInIds: pendingIn,
    friendshipIdByOther: idByOther,
  };
}

export function statusOf(graph: FriendGraph, viewerId: string, otherId: string): FriendStatus {
  if (viewerId === otherId) return "self";
  if (graph.acceptedIds.has(otherId)) return "friends";
  if (graph.pendingOutIds.has(otherId)) return "pending_out";
  if (graph.pendingInIds.has(otherId)) return "pending_in";
  return "none";
}

// Resolve a set of user ids to their public profile summaries (name + avatar).
export async function loadUserSummaries(userIds: string[]): Promise<Map<string, FriendUserSummary>> {
  if (userIds.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, image: true },
  });
  return new Map(users.map((u) => [u.id, u]));
}
