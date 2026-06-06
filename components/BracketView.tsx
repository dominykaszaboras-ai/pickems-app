"use client";
// Top-level interactive view: Swiss stages + playoff bracket + live pickems score panel.
// All state lives client-side (simulation overrides are not persisted).

import { useMemo, useState } from "react";
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
  const [overrides, setOverrides] = useState<WinnerOverrides>({});

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
        />
      ))}
      {playoffs && (
        <PlayoffBracket stage={playoffs} overrides={overrides} setOverride={setOverride} pickem={myPickem} />
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
