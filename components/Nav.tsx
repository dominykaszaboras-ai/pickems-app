"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import clsx from "clsx";
import { RefreshButton } from "./RefreshButton";
import { ThemeToggle } from "./ThemeToggle";

export function Nav() {
  const { data: session, status } = useSession();
  const [pendingCount, setPendingCount] = useState(0);
  const [picksOpenStage, setPicksOpenStage] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Lightweight poll for both:
  //   1. incoming friend requests (dot on avatar)
  //   2. open stage with no picks submitted (dot on "My Pickems")
  // Runs together every 60s so we make one network sweep, not two.
  useEffect(() => {
    if (status !== "authenticated") {
      setPendingCount(0);
      setPicksOpenStage(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const [friendsRes, picksRes] = await Promise.all([
          fetch("/api/friends", { cache: "no-store" }),
          fetch("/api/pickems/status", { cache: "no-store" }),
        ]);
        if (friendsRes.ok) {
          const json = await friendsRes.json();
          if (!cancelled) setPendingCount((json.pendingIn ?? []).length);
        }
        if (picksRes.ok) {
          const json = await picksRes.json();
          if (!cancelled) {
            setPicksOpenStage(json.needsPicks ? (json.stage as string) : null);
          }
        }
      } catch {
        // network blip — ignore, next tick will retry
      }
    };
    tick();
    const id = setInterval(tick, 60_000);
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

  // Close the menu on outside-click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const viewerId = (session?.user as any)?.id as string | undefined;

  return (
    <nav className="sticky top-0 z-30 border-b border-line bg-ink/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <Link href="/" className="text-base font-bold tracking-tight">
          <span className="text-accent">CS2</span> Pickems
        </Link>
        <div className="flex flex-1 gap-4 text-sm text-muted">
          <Link href="/bracket" className="hover:text-text">Bracket</Link>
          <Link
            href="/pickems"
            className="relative hover:text-text"
            title={picksOpenStage ? `${picksOpenStage} open — submit your picks` : undefined}
          >
            My Pickems
            {picksOpenStage && (
              <span
                aria-label={`${picksOpenStage} open — picks needed`}
                className="absolute -right-2 -top-1 h-2 w-2 animate-pulse rounded-full bg-accent"
              />
            )}
          </Link>
          <Link href="/leaderboard" className="hover:text-text">Leaderboard</Link>
        </div>
        {session?.user ? (
          <div className="flex items-center gap-3 text-sm">
            <RefreshButton />
            <ThemeToggle />
            <div ref={menuRef} className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className={clsx(
                  "flex items-center gap-2 rounded-full px-1 py-0.5 hover:text-text",
                  menuOpen && "text-text",
                )}
              >
                <span className="relative">
                  {session.user.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={session.user.image}
                      alt={session.user.name ?? "avatar"}
                      width={24}
                      height={24}
                      className="rounded-full border border-line"
                    />
                  ) : (
                    <div className="h-6 w-6 rounded-full border border-line bg-panel2" />
                  )}
                  {pendingCount > 0 && (
                    <span
                      aria-label={`${pendingCount} pending friend request${pendingCount === 1 ? "" : "s"}`}
                      className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-ink"
                    >
                      {pendingCount > 9 ? "9+" : pendingCount}
                    </span>
                  )}
                </span>
                <span className="text-muted">
                  {session.user.name ?? session.user.email}
                </span>
                <svg
                  width={10}
                  height={10}
                  viewBox="0 0 10 10"
                  className={clsx(
                    "text-muted transition-transform",
                    menuOpen && "rotate-180",
                  )}
                  aria-hidden
                >
                  <path d="M1 3l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                </svg>
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-40 mt-1 w-44 overflow-hidden rounded-xl border border-line bg-panel shadow-lg"
                >
                  {viewerId && (
                    <Link
                      href={`/users/${viewerId}`}
                      role="menuitem"
                      onClick={() => setMenuOpen(false)}
                      className="block px-3 py-2 text-sm text-muted hover:bg-panel2 hover:text-text"
                    >
                      My profile
                    </Link>
                  )}
                  <Link
                    href="/friends"
                    role="menuitem"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center justify-between px-3 py-2 text-sm text-muted hover:bg-panel2 hover:text-text"
                  >
                    <span>Friends</span>
                    {pendingCount > 0 && (
                      <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-ink">
                        {pendingCount > 9 ? "9+" : pendingCount}
                      </span>
                    )}
                  </Link>
                  <div className="border-t border-line" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      signOut();
                    }}
                    className="block w-full px-3 py-2 text-left text-sm text-muted hover:bg-panel2 hover:text-loss"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-sm">
            <ThemeToggle />
            <Link href="/auth/signin" className="rounded bg-accent px-3 py-1 font-semibold text-ink">
              Sign in with Steam
            </Link>
          </div>
        )}
      </div>
    </nav>
  );
}
