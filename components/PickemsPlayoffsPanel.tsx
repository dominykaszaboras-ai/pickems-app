"use client";
// Client wrapper that renders BOTH playoff views on /pickems:
//   1. "Your playoff picks" — a small, read-only mini-bracket layout of
//      the user's picks (PlayoffPickBracket), tinted by correctness.
//   2. "Live bracket" — the real data-backed bracket showing actual
//      matchups, scores, and current state (PlayoffBracket), with the
//      simulator still attached so the user can play with overrides.
//
// We compute the score client-side so override-driven simulations live
// in the same place as the bracket UI — matches what /bracket does.

import { useMemo, useState } from "react";
import type { ClientPickem, ClientTournament } from "@/lib/types";
import { scorePickem, type WinnerOverrides } from "@/lib/scoring";
import { PlayoffPickBracket } from "./PlayoffPickBracket";
import { PlayoffBracket } from "./PlayoffBracket";

export function PickemsPlayoffsPanel({
  tournament,
  pickem,
}: {
  tournament: ClientTournament;
  pickem: ClientPickem | null;
}) {
  const [overrides, setOverrides] = useState<WinnerOverrides>({});

  const playoffsStage = tournament.stages.find((s) => s.kind === "PLAYOFFS");

  // PlayoffPickBracket needs a score for the per-pick correct/wrong tint.
  // Compute against the real winners (no overrides) so the picks view
  // reflects the actual current state, not the simulation.
  const realScore = useMemo(
    () => (pickem ? scorePickem(tournament, pickem, {}) : null),
    [tournament, pickem],
  );

  const teamsById = useMemo(() => {
    const m = new Map<string, NonNullable<typeof playoffsStage>["teams"][number]>();
    if (!playoffsStage) return m;
    for (const t of playoffsStage.teams) m.set(t.id, t);
    return m;
  }, [playoffsStage]);

  const liveScore = useMemo(
    () => (pickem ? scorePickem(tournament, pickem, overrides) : null),
    [tournament, pickem, overrides],
  );

  if (!playoffsStage) return null;

  function setOverride(matchId: string, teamId: string | null) {
    setOverrides((prev) => {
      const next = { ...prev };
      if (teamId === null) delete next[matchId];
      else next[matchId] = teamId;
      return next;
    });
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      <section className="rounded-2xl border border-line bg-panel p-4">
        <header className="mb-3">
          <h2 className="text-lg font-semibold">Your playoff picks</h2>
          <p className="text-xs text-muted">
            What you locked in — tinted green when correct, red when busted,
            grey while still in flight.
          </p>
        </header>
        {pickem && realScore ? (
          <PlayoffPickBracket stage={playoffsStage} score={realScore} teamsById={teamsById} />
        ) : (
          <p className="text-sm text-muted">
            No playoff picks submitted yet. Pick the bracket in the form below.
          </p>
        )}
      </section>

      <section className="overflow-hidden">
        <header className="mb-2">
          <h2 className="text-lg font-semibold">Live bracket</h2>
          <p className="text-xs text-muted">
            Actual current state of the playoffs. Click a team in any
            still-open match to simulate the rest of the bracket.
          </p>
        </header>
        <PlayoffBracket
          stage={playoffsStage}
          overrides={overrides}
          setOverride={setOverride}
          pickem={pickem}
          score={liveScore}
          tournament={tournament}
        />
      </section>
    </div>
  );
}
