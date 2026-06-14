"use client";

// Friend-action button shown on /users/[id]. Reflects the viewer's current
// status with the profile owner and supports add / accept-decline / unfriend
// inline (no full page reload). Hidden entirely when the viewer is the
// profile owner or not signed in (the server passes initialStatus="self" or
// "anon" in those cases).

import { useState } from "react";

export type ProfileFriendStatus =
  | "anon"          // viewer not signed in
  | "self"          // viewer = profile owner
  | "friends"
  | "pending_out"
  | "pending_in"
  | "none";

export function FriendButton({
  profileUserId,
  initialStatus,
  initialFriendshipId,
}: {
  profileUserId: string;
  initialStatus: ProfileFriendStatus;
  initialFriendshipId: string | null;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [friendshipId, setFriendshipId] = useState<string | null>(initialFriendshipId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "anon" || status === "self") return null;

  async function send(req: () => Promise<Response>, onOk: (json: any) => void) {
    setBusy(true);
    setError(null);
    try {
      const res = await req();
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Action failed");
      } else {
        onOk(json);
      }
    } finally {
      setBusy(false);
    }
  }

  const add = () =>
    send(
      () =>
        fetch("/api/friends/request", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: profileUserId }),
        }),
      (json) => {
        setStatus(json.status);
        setFriendshipId(json.friendshipId ?? null);
      },
    );

  const respond = (action: "accept" | "decline") =>
    send(
      () =>
        fetch("/api/friends/respond", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ friendshipId, action }),
        }),
      (json) => {
        setStatus(json.status);
        if (action === "decline") setFriendshipId(null);
      },
    );

  const remove = () =>
    send(
      () => fetch(`/api/friends/${friendshipId}`, { method: "DELETE" }),
      () => {
        setStatus("none");
        setFriendshipId(null);
      },
    );

  return (
    <div className="flex items-center gap-2">
      {status === "none" && (
        <button
          disabled={busy}
          onClick={add}
          className="rounded bg-accent px-3 py-1 text-sm font-semibold text-ink disabled:opacity-50"
        >
          Add friend
        </button>
      )}
      {status === "pending_out" && (
        <>
          <span className="text-xs text-muted">Request sent</span>
          <button
            disabled={busy || !friendshipId}
            onClick={remove}
            className="rounded border border-line px-3 py-1 text-xs text-muted hover:text-loss disabled:opacity-50"
          >
            Cancel
          </button>
        </>
      )}
      {status === "pending_in" && (
        <>
          <button
            disabled={busy || !friendshipId}
            onClick={() => respond("accept")}
            className="rounded bg-accent px-3 py-1 text-sm font-semibold text-ink disabled:opacity-50"
          >
            Accept
          </button>
          <button
            disabled={busy || !friendshipId}
            onClick={() => respond("decline")}
            className="rounded border border-line px-3 py-1 text-sm text-muted hover:text-text disabled:opacity-50"
          >
            Decline
          </button>
        </>
      )}
      {status === "friends" && (
        <>
          <span className="text-xs text-win">Friends ✓</span>
          <button
            disabled={busy || !friendshipId}
            onClick={remove}
            className="rounded border border-line px-3 py-1 text-xs text-muted hover:text-loss disabled:opacity-50"
          >
            Unfriend
          </button>
        </>
      )}
      {error && <span className="ml-2 text-xs text-loss">{error}</span>}
    </div>
  );
}
