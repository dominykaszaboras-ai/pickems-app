"use client";
// Top-level interactive view: Swiss stages + playoff bracket + live pickems score panel.
// All state lives client-side (simulation overrides are not persisted).

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ClientPickem, ClientTournament } from "@/lib/types";
import { scorePickem, type WinnerOverrides } from "@/lib/scoring";
import { SwissStage } from "./SwissStage";
import { PlayoffBracket } from "./PlayoffBracket";
import { UpcomingSchedule } from "./UpcomingSchedule";
import { TournamentStatus } from "./TournamentStatus";
import { StageProjection } from "./StageProjection";
import { LiveStreamEmbed } from "./LiveStreamEmbed";

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

  // "Match just went LIVE" toast. We track which match IDs we've already
  // shown a toast for so re-renders don't re-toast — and so a match
  // flipping FINISHED→LIVE doesn't repeatedly nag (rare but happens with
  // overtime corrections). The toast offers "Watch live" which scrolls
  // the live stream embed into view.
  //
  // IMPORTANT: pre-seed the seen-set with matches that were ALREADY LIVE
  // on first paint. Otherwise a user landing on /bracket during an
  // in-progress match would be told the match "just went LIVE" — annoying
  // and incorrect. Only true PENDING/FINISHED → LIVE transitions should
  // toast.
  const [newlyLive, setNewlyLive] = useState<string[]>([]);
  const seenLiveRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const currentlyLive = tournament.stages.flatMap((s) =>
      s.matches.filter((m) => m.status === "LIVE").map((m) => m.id),
    );
    if (seenLiveRef.current === null) {
      // First-render init: everything currently live is already-seen, so
      // we don't toast retroactively.
      seenLiveRef.current = new Set(currentlyLive);
      return;
    }
    const fresh = currentlyLive.filter((id) => !seenLiveRef.current!.has(id));
    if (fresh.length === 0) return;
    fresh.forEach((id) => seenLiveRef.current!.add(id));
    setNewlyLive((prev) => [...prev, ...fresh]);
    // Auto-dismiss after 12s.
    const t = setTimeout(() => {
      setNewlyLive((prev) => prev.filter((id) => !fresh.includes(id)));
    }, 12_000);
    return () => clearTimeout(t);
  }, [tournament]);

  function scrollToLive() {
    const el = document.getElementById("live-stream");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    setNewlyLive([]);
  }

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

  // Descending stage order — most recent on top. PLAYOFFS first, then
  // Stage 3 / 2 / 1. Mirrors how the user thinks about the tournament once
  // it's underway: "what's happening now" up top, "what's already done"
  // scrolling down.
  const STAGE_RANK: Record<string, number> = {
    PLAYOFFS: 4,
    STAGE_3: 3,
    STAGE_2: 2,
    STAGE_1: 1,
  };
  const orderedStages = [...tournament.stages].sort(
    (a, b) => (STAGE_RANK[b.kind] ?? 0) - (STAGE_RANK[a.kind] ?? 0),
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Sticky so the per-stage score chips stay visible while scrolling
          through the long Swiss stages. `top` matches the Nav height
          (~48px) so the two glue together with no gap. */}
      <header className="sticky top-12 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-panel/95 p-4 backdrop-blur">
        <div>
          <h1 className="text-xl font-bold">{tournament.name}</h1>
          <p className="text-xs text-muted">
            {tournament.lastSyncedAt
              ? `Last synced ${new Date(tournament.lastSyncedAt).toLocaleString()}`
              : "Not synced yet"}
          </p>
        </div>
        {myScore && (
          <div className="flex items-center gap-2 text-sm sm:gap-4">
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

      {newlyLive.length > 0 && (
        <button
          type="button"
          onClick={scrollToLive}
          className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-loss/40 bg-loss px-4 py-2 text-sm font-semibold text-ink shadow-lg hover:brightness-110"
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-ink" />
          {newlyLive.length === 1 ? "Match just went LIVE" : `${newlyLive.length} matches went LIVE`}
          <span className="text-xs opacity-80">Watch ↓</span>
        </button>
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

      <TournamentStatus tournament={tournament} />

      <div id="live-stream">
        <LiveStreamEmbed tournament={tournament} />
      </div>

      <UpcomingSchedule tournament={tournament} />

      {/* Stage 3 preview — only renders when Stage 2 is concluded AND Stage 3
          has no real matches yet. Auto-hides as soon as real data arrives. */}
      <StageProjection tournament={tournament} forStage="STAGE_3" sourceStage="STAGE_2" />

      {orderedStages.map((stage) =>
        stage.kind === "PLAYOFFS" ? (
          <PlayoffBracket
            key={stage.id}
            stage={stage}
            pickem={myPickem}
            tournament={tournament}
          />
        ) : (
          <SwissStage
            key={stage.id}
            stage={stage}
            overrides={overrides}
            setOverride={setOverride}
            pickem={myPickem}
            score={myScore}
            tournament={tournament}
          />
        ),
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
