"use client";
// Fetches the viewer's friends' picks for the active tournament once and
// shares them via context so every MatchCard can render a small "N
// friends picked this team" badge without each one re-fetching.
//
// The endpoint sets a 30s cache header, so this provider intentionally
// only fetches on mount + on tab-visible. Friend picks change at human
// speed; a refresh every 30s on tab focus is fine.

import { createContext, useContext, useEffect, useState } from "react";
import { useSession } from "next-auth/react";

export interface FriendSummary {
  id: string;
  name: string | null;
  image: string | null;
}

export interface FriendPick {
  friendId: string;
  kind: string;
  round: number | null;
}

interface FriendsPicksData {
  friends: FriendSummary[];
  byTeam: Record<string, FriendPick[]>;
  friendById: Map<string, FriendSummary>;
}

const empty: FriendsPicksData = {
  friends: [],
  byTeam: {},
  friendById: new Map(),
};

const FriendsPicksContext = createContext<FriendsPicksData>(empty);

export function useFriendsPicks(): FriendsPicksData {
  return useContext(FriendsPicksContext);
}

export function FriendsPicksProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const [data, setData] = useState<FriendsPicksData>(empty);

  useEffect(() => {
    if (status !== "authenticated") {
      setData(empty);
      return;
    }
    let cancelled = false;
    const load = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const r = await fetch("/api/friends/picks", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as {
          friends: FriendSummary[];
          byTeam: Record<string, FriendPick[]>;
        };
        if (cancelled) return;
        setData({
          friends: j.friends,
          byTeam: j.byTeam,
          friendById: new Map(j.friends.map((f) => [f.id, f])),
        });
      } catch {
        /* swallow */
      }
    };
    load();
    const onVis = () => {
      if (!document.hidden) load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [status]);

  return (
    <FriendsPicksContext.Provider value={data}>{children}</FriendsPicksContext.Provider>
  );
}
