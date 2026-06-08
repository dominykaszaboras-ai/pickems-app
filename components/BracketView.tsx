"use client";
// Top-level interactive view: Swiss stages + playoff bracket + live pickems score panel.
// All state lives client-side (simulation overrides are not persisted).

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ClientPickem, ClientTournament } from "@/lib/types";
import { scorePickem, type WinnerOverrides } from "@/lib/scoring";
import { SwissStage } from "./SwissStage";
import { PlayoffBracket } from "./PlayoffBracket";

export function BracketView({
  tournament,
  myPickem,
}: {
  tournament: ClientTournament;
  myPickem: ClientPickem | null;
}) {
  const router = useRouter();
  const [overrides, setOverrides] = useState<WinnerOverrides>({});

  // Auto-refresh from server while any match is live. Polls /api/last-sync
  // every 30s and asks Next to re-render when the timestamp advances —
  // cheap and avoids any websocket plumbing.
  const liveCount = useMemo(
    () => tournament.stages.reduce((n, s) => n + s.matches.filter((m) => m.status === "LIVE").length, 0),
    [tournament],
  );
  const lastStamp = useRef<string | null>(tournament.lastSyncedAt);
  useEffect(() => {
    if (liveCount === 0) return;
    const id = setInterval(async () => {
      try {
        const r = await fetch("/api/last-sync", { cache: "no-store" });
        const d = await r.json();
        const stamp: string | null = d?.lastSyncedAt ?? null;
        if (stamp && stamp !== lastStamp.current) {
          lastStamp.current = stamp;
          router.refresh();
        }
      } catch {
        /* swallow */
      }
    }, 30_000);
    return () => clearInterval(id);
  }, [liveCount, router]);

  function setOverride(matchId: string, teamId: string | null) {
    setOverrides((prev) => {
      const next = { ...prev };
      if (teamId === null) delete next[matchId];
      else next[matchId] = teamId;
      return next;
    });
  }

  const myScore = useMemo(
    () => (myPickem ? scorePickem(tournament, myPickem, overrides) : null),
    [tournament, myPickem, overrides],
  );

  const swissStages = tournament.stages
    .filter((s) => s.kind !== "PLAYOFFS")
    .sort((a, b) => a.kind.localeCompare(b.kind));
  const playoffs = tournament.stages.find((s) => s.kind === "PLAYOFFS");

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between rounded-2xl border border-line bg-panel p-4">
        <div>
          <h1 className="text-xl font-bold">{tournament.name}</h1>
          <p className="text-xs text-muted">
            {tournament.lastSyncedAt
              ? `Last synced ${new Date(tournament.lastSyncedAt).toLocaleString()}`
              : "Not synced yet"}
          </p>
        </div>
        {myScore && (
          <div className="flex items-center gap-4 text-sm">
            <ScoreChip label="S1" value={myScore.byStage.STAGE_1} />
            <ScoreChip label="S2" value={myScore.byStage.STAGE_2} />
            <ScoreChip label="S3" value={myScore.byStage.STAGE_3} />
            <ScoreChip label="PO" value={myScore.byStage.PLAYOFFS} />
            <ScoreChip label="Total" value={myScore.total} accent />
          </div>
        )}
      </header>

      {liveCount > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-loss/40 bg-loss/10 px-4 py-2 text-sm">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 animate-pulse rounded-full bg-loss" />
            <span className="font-semibold text-loss">{liveCount} match{liveCount === 1 ? "" : "es"} live</span>
          </span>
          <span className="text-muted">— scores refresh automatically every 30s</span>
        </div>
      )}

      {Object.keys(overrides).length > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-accent/40 bg-accent/10 px-4 py-2 text-sm">
          <span>
            Simulating {Object.keys(overrides).length} match{Object.keys(overrides).length === 1 ? "" : "es"} — your pickems score updates live.
          </span>
          <button
            onClick={() => setOverrides({})}
            className="rounded bg-accent px-3 py-1 text-xs font-semibold text-ink"
          >
            Reset simulation
          </button>
        </div>
      )}

      {swissStages.map((stage) => (
        <SwissStage
          key={stage.id}
          stage={stage}
          overrides={overrides}
          setOverride={setOverride}
          pickem={myPickem}
          score={myScore}
        />
      ))}
      {playoffs && (
        <PlayoffBracket
          stage={playoffs}
          overrides={overrides}
          setOverride={setOverride}
          pickem={myPickem}
          score={myScore}
        />
      )}
    </div>
  );
}

function ScoreChip({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div
      className={
        "flex flex-col items-end rounded-lg border px-3 py-1 " +
        (accent ? "border-accent bg-accent/10" : "border-line bg-panel2")
      }
    >
      <span className="text-[10px] uppercase text-muted">{label}</span>
      <span className={"font-mono text-base " + (accent ? "text-accent" : "")}>{value}</span>
    </div>
  );
}
