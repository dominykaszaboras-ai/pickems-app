"use client";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { RefreshButton } from "./RefreshButton";

export function Nav() {
  const { data: session } = useSession();
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
        </div>
        {session?.user ? (
          <div className="flex items-center gap-3 text-sm">
            <RefreshButton />
            <div className="flex items-center gap-2">
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
            </div>
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
