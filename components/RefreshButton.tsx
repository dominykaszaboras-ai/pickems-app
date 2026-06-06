"use client";
// Triggers /api/refresh -> dispatches the GitHub Actions sync workflow,
// then polls /api/last-sync until the lastSyncedAt timestamp changes (or
// a timeout fires) and asks the Next.js router to re-render the current
// page with fresh data.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";

type Phase = "idle" | "dispatching" | "waiting" | "done" | "error";

const POLL_INTERVAL_MS = 4_000;
const POLL_TIMEOUT_MS = 90_000;

export function RefreshButton() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const initialStamp = useRef<string | null>(null);

  // Capture the current lastSyncedAt once on mount.
  useEffect(() => {
    fetch("/api/last-sync")
      .then((r) => r.json())
      .then((d) => {
        initialStamp.current = d?.lastSyncedAt ?? null;
      })
      .catch(() => {});
  }, []);

  async function onClick() {
    setPhase("dispatching");
    setMsg(null);
    try {
      const r = await fetch("/api/refresh", { method: "POST" });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setPhase("error");
        setMsg(body.error ?? `Request failed (${r.status})`);
        return;
      }
    } catch (e) {
      setPhase("error");
      setMsg((e as Error).message);
      return;
    }

    // Poll until lastSyncedAt advances or we time out.
    setPhase("waiting");
    setMsg("running on GitHub Actions…");
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
      try {
        const r = await fetch("/api/last-sync", { cache: "no-store" });
        const d = await r.json();
        const stamp: string | null = d?.lastSyncedAt ?? null;
        if (stamp && stamp !== initialStamp.current) {
          initialStamp.current = stamp;
          setPhase("done");
          setMsg("updated");
          router.refresh();
          setTimeout(() => {
            setPhase("idle");
            setMsg(null);
          }, 2_500);
          return;
        }
      } catch {
        // swallow; we'll just keep polling until the timeout
      }
    }

    setPhase("error");
    setMsg("timed out — try again");
  }

  const busy = phase === "dispatching" || phase === "waiting";
  const label = {
    idle: "Sync now",
    dispatching: "Triggering…",
    waiting: "Syncing…",
    done: "✓ Updated",
    error: "Sync failed",
  }[phase];

  return (
    <button
      onClick={onClick}
      disabled={busy}
      title="Run the HLTV sync workflow and reload data"
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
      {msg && phase !== "idle" && (
        <span className="text-[10px] opacity-70">{msg}</span>
      )}
    </button>
  );
}
