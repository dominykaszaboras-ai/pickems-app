"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { RefreshButton } from "./RefreshButton";

export function Nav() {
  const { data: session, status } = useSession();
  const [pendingCount, setPendingCount] = useState(0);

  // Lightweight pending-request poll. Fetches /api/friends on session-ready
  // and every 60s thereafter so the dot updates without a page reload.
  useEffect(() => {
    if (status !== "authenticated") {
      setPendingCount(0);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      // Skip while the tab is in the background — costs nothing to defer and
      // keeps quietly-open tabs from hammering the API forever.
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const res = await fetch("/api/friends", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setPendingCount((json.pendingIn ?? []).length);
      } catch {
        // network blip — ignore, next tick will retry
      }
    };
    tick();
    const id = setInterval(tick, 60_000);
    // Fire immediately when the tab regains focus so the badge is fresh.
    const onVis = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [status]);

  return (
    <nav className="sticky top-0 z-30 border-b border-line bg-ink/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <Link href="/" className="text-base font-bold tracking-tight">
          <span className="text-accent">CS2</span> Pickems
        </Link>
        <div className="flex flex-1 gap-4 text-sm text-muted">
          <Link href="/bracket" className="hover:text-text">Bracket</Link>
          <Link href="/pickems" className="hover:text-text">My Pickems</Link>
          <Link href="/leaderboard" className="hover:text-text">Leaderboard</Link>
          {session?.user && (
            <Link href="/friends" className="relative hover:text-text">
              Friends
              {pendingCount > 0 && (
                <span
                  aria-label={`${pendingCount} pending friend request${pendingCount === 1 ? "" : "s"}`}
                  className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-ink"
                >
                  {pendingCount > 9 ? "9+" : pendingCount}
                </span>
              )}
            </Link>
          )}
        </div>
        {session?.user ? (
          <div className="flex items-center gap-3 text-sm">
            <RefreshButton />
            <Link href={`/users/${(session.user as any).id}`} className="flex items-center gap-2 hover:text-text">
              {session.user.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={session.user.image}
                  alt={session.user.name ?? "avatar"}
                  width={24}
                  height={24}
                  className="rounded-full border border-line"
                />
              )}
              <span className="text-muted">{session.user.name ?? session.user.email}</span>
            </Link>
            <button onClick={() => signOut()} className="text-muted hover:text-text">Sign out</button>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-sm">
            <Link href="/auth/signin" className="text-muted hover:text-text">Sign in</Link>
            <Link href="/auth/signup" className="rounded bg-accent px-3 py-1 font-semibold text-ink">Sign up</Link>
          </div>
        )}
      </div>
    </nav>
  );
}
