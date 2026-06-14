"use client";
// Triggers /api/refresh -> kicks the HLTV sync (server hides the dispatch
// detail), then polls /api/last-sync until the lastSyncedAt timestamp
// changes (or a timeout fires) and asks the Next.js router to re-render
// the current page with fresh data.
//
// When idle, the button label is "Synced Xs ago" / "Xm ago" using the most
// recently observed lastSyncedAt — a 1s ticker keeps it live without
// thrashing the network.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { formatAgo } from "@/lib/formatTime";

type Phase = "idle" | "dispatching" | "waiting" | "done" | "error";

const POLL_INTERVAL_MS = 4_000;
const POLL_TIMEOUT_MS = 90_000;

export function RefreshButton() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  // Tick state — bumped every second so `formatAgo` re-evaluates against
  // the latest now(). We don't store the value, just a counter, so React
  // re-renders on schedule.
  const [, setTick] = useState(0);

  // Capture the current lastSyncedAt once on mount so the button shows
  // "Synced Xs ago" right away.
  useEffect(() => {
    fetch("/api/last-sync")
      .then((r) => r.json())
      .then((d) => setLastSyncedAt(d?.lastSyncedAt ?? null))
      .catch(() => {});
  }, []);

  // 1Hz ticker for the relative-time label. Cheap — it just bumps a
  // counter; the actual "Xs ago" string is derived on render.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1_000);
    return () => clearInterval(id);
  }, []);

  async function onClick() {
    setPhase("dispatching");
    setError(null);
    try {
      const r = await fetch("/api/refresh", { method: "POST" });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setPhase("error");
        setError(body.error ?? `Request failed (${r.status})`);
        return;
      }
    } catch (e) {
      setPhase("error");
      setError((e as Error).message);
      return;
    }

    // Poll until lastSyncedAt advances or we time out. We deliberately
    // don't expose where the sync runs — the user just sees "Syncing…".
    setPhase("waiting");
    const initialStamp = lastSyncedAt;
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
      try {
        const r = await fetch("/api/last-sync", { cache: "no-store" });
        const d = await r.json();
        const stamp: string | null = d?.lastSyncedAt ?? null;
        if (stamp && stamp !== initialStamp) {
          setLastSyncedAt(stamp);
          setPhase("done");
          router.refresh();
          // Drop back to the "Synced Xs ago" label after a brief pause —
          // long enough to register the green tick visually.
          setTimeout(() => setPhase("idle"), 1_500);
          return;
        }
      } catch {
        // swallow; we'll just keep polling until the timeout
      }
    }

    setPhase("error");
    setError("timed out — try again");
  }

  const busy = phase === "dispatching" || phase === "waiting";
  const label = (() => {
    if (phase === "dispatching" || phase === "waiting") return "Syncing…";
    if (phase === "done") return "✓ Updated";
    if (phase === "error") return "Sync failed";
    // idle
    return lastSyncedAt ? `Synced ${formatAgo(lastSyncedAt)}` : "Sync now";
  })();

  return (
    <button
      onClick={onClick}
      disabled={busy}
      title={
        lastSyncedAt
          ? `Last sync: ${new Date(lastSyncedAt).toLocaleString()}`
          : "Run the HLTV sync and reload data"
      }
      className={clsx(
        "flex items-center gap-2 rounded border px-3 py-1 text-sm",
        phase === "error"
          ? "border-loss text-loss"
          : phase === "done"
          ? "border-win text-win"
          : "border-line text-muted hover:text-text",
        busy && "cursor-progress opacity-80",
      )}
    >
      <span
        className={clsx(
          "inline-block h-1.5 w-1.5 rounded-full",
          phase === "idle" && "bg-muted",
          busy && "animate-pulse bg-accent",
          phase === "done" && "bg-win",
          phase === "error" && "bg-loss",
        )}
      />
      <span>{label}</span>
      {error && phase === "error" && (
        <span className="text-[10px] opacity-70">{error}</span>
      )}
    </button>
  );
}
