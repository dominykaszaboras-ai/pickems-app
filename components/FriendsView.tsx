"use client";

// Friends page client component.
// Three sections: pending in (with Accept/Decline), friends (with Unfriend +
// "View picks" link), and pending out (with Cancel). A search box at the top
// queries /api/users/search and lets the viewer send requests inline.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

interface PublicUser {
  id: string;
  name: string | null;
  image: string | null;
  friendshipId?: string | null;
}

interface FriendsApiResponse {
  friends: PublicUser[];
  pendingIn: PublicUser[];
  pendingOut: PublicUser[];
}

type SearchStatus = "self" | "friends" | "pending_out" | "pending_in" | "none";

interface SearchHit {
  id: string;
  name: string | null;
  image: string | null;
  status: SearchStatus;
}

export function FriendsView() {
  const [data, setData] = useState<FriendsApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/friends", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load friends");
      const json = (await res.json()) as FriendsApiResponse;
      setData(json);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load friends");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Debounced search: fires 250ms after the last keystroke when q.length >= 3.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/users/search?q=${encodeURIComponent(trimmed)}`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          setSearchResults([]);
        } else {
          const json = await res.json();
          setSearchResults(json.results ?? []);
        }
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // After any mutation we re-fetch /api/friends; also re-run search so result
  // buttons reflect the new state without the user having to retype.
  const mutate = useCallback(
    async (req: () => Promise<Response>) => {
      const res = await req();
      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: "Action failed" }));
        setError(json.error ?? "Action failed");
        return;
      }
      setError(null);
      await refresh();
      if (query.trim().length >= 3) {
        // Re-run the search to refresh status pills.
        const r2 = await fetch(
          `/api/users/search?q=${encodeURIComponent(query.trim())}`,
          { cache: "no-store" },
        );
        if (r2.ok) {
          const json = await r2.json();
          setSearchResults(json.results ?? []);
        }
      }
    },
    [refresh, query],
  );

  const sendRequest = (userId: string) =>
    mutate(() =>
      fetch("/api/friends/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId }),
      }),
    );

  const respond = (friendshipId: string, action: "accept" | "decline") =>
    mutate(() =>
      fetch("/api/friends/respond", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ friendshipId, action }),
      }),
    );

  const remove = (friendshipId: string) =>
    mutate(() => fetch(`/api/friends/${friendshipId}`, { method: "DELETE" }));

  const friends = data?.friends ?? [];
  const pendingIn = data?.pendingIn ?? [];
  const pendingOut = data?.pendingOut ?? [];

  const searchHasResults = useMemo(
    () => query.trim().length >= 3,
    [query],
  );

  return (
    <div className="flex flex-col gap-8">
      {error && (
        <div className="rounded-xl border border-loss/60 bg-loss/10 p-3 text-sm text-loss">
          {error}
        </div>
      )}

      {/* Search */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-muted">Find users</h2>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type at least 3 characters of a player's name…"
          className="w-full rounded-xl border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent"
          maxLength={40}
        />
        <div className="mt-3 flex flex-col gap-1">
          {searchHasResults && searching && (
            <div className="text-xs text-muted">Searching…</div>
          )}
          {searchHasResults && !searching && searchResults.length === 0 && (
            <div className="text-xs text-muted">No users match.</div>
          )}
          {searchResults.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              actions={
                <SearchActions
                  hit={u}
                  onAdd={() => sendRequest(u.id)}
                />
              }
            />
          ))}
        </div>
      </section>

      {/* Incoming requests */}
      {pendingIn.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase text-muted">
            Pending requests ({pendingIn.length})
          </h2>
          <div className="flex flex-col gap-1">
            {pendingIn.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                actions={
                  <div className="flex gap-2">
                    <button
                      onClick={() => u.friendshipId && respond(u.friendshipId, "accept")}
                      className="rounded bg-accent px-3 py-1 text-xs font-semibold text-ink"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => u.friendshipId && respond(u.friendshipId, "decline")}
                      className="rounded border border-line px-3 py-1 text-xs text-muted hover:text-text"
                    >
                      Decline
                    </button>
                  </div>
                }
              />
            ))}
          </div>
        </section>
      )}

      {/* Accepted friends */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-muted">
          Friends ({friends.length})
        </h2>
        {loading ? (
          <div className="text-xs text-muted">Loading…</div>
        ) : friends.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line bg-panel/40 p-4 text-sm text-muted">
            No friends yet — use the search above to find players.
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {friends.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                actions={
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/users/${u.id}`}
                      className="rounded border border-line px-3 py-1 text-xs hover:text-accent"
                    >
                      View picks
                    </Link>
                    <button
                      onClick={() => u.friendshipId && remove(u.friendshipId)}
                      className="rounded border border-line px-3 py-1 text-xs text-muted hover:text-loss"
                    >
                      Unfriend
                    </button>
                  </div>
                }
              />
            ))}
          </div>
        )}
      </section>

      {/* Outgoing pending */}
      {pendingOut.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase text-muted">
            Sent requests ({pendingOut.length})
          </h2>
          <div className="flex flex-col gap-1">
            {pendingOut.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                actions={
                  <button
                    onClick={() => u.friendshipId && remove(u.friendshipId)}
                    className="rounded border border-line px-3 py-1 text-xs text-muted hover:text-loss"
                  >
                    Cancel
                  </button>
                }
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function UserRow({
  user,
  actions,
}: {
  user: PublicUser;
  actions: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-panel/60 px-3 py-2">
      <Link
        href={`/users/${user.id}`}
        className="flex items-center gap-2 hover:text-accent"
      >
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.image}
            alt=""
            width={28}
            height={28}
            className="rounded-full border border-line"
          />
        ) : (
          <div className="h-7 w-7 rounded-full border border-line bg-panel2" />
        )}
        <span className="text-sm">{user.name ?? "Anonymous"}</span>
      </Link>
      <div>{actions}</div>
    </div>
  );
}

function SearchActions({
  hit,
  onAdd,
}: {
  hit: SearchHit;
  onAdd: () => void;
}) {
  if (hit.status === "self") {
    return <span className="text-xs text-muted">You</span>;
  }
  if (hit.status === "friends") {
    return <span className="text-xs text-win">Friends ✓</span>;
  }
  if (hit.status === "pending_out") {
    return <span className="text-xs text-muted">Request sent</span>;
  }
  if (hit.status === "pending_in") {
    return (
      <span className="text-xs text-muted">
        They asked you — see Pending requests above
      </span>
    );
  }
  return (
    <button
      onClick={onAdd}
      className="rounded bg-accent px-3 py-1 text-xs font-semibold text-ink"
    >
      Add friend
    </button>
  );
}
