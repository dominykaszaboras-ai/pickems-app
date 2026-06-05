"use client";
import { useMemo } from "react";
import type { ClientPickem, ClientStage } from "@/lib/types";
import { effectiveWinner, type WinnerOverrides } from "@/lib/scoring";
import { MatchCard } from "./MatchCard";

const ROUND_LABELS: Record<number, string> = {
  1: "Quarter-finals",
  2: "Semi-finals",
  3: "Grand Final",
};

export function PlayoffBracket({
  stage,
  overrides,
  setOverride,
  pickem,
}: {
  stage: ClientStage;
  overrides: WinnerOverrides;
  setOverride: (matchId: string, teamId: string | null) => void;
  pickem: ClientPickem | null;
}) {
  const rounds = useMemo(() => {
    const map: Record<number, typeof stage.matches> = {};
    for (const m of stage.matches) {
      const r = m.bracketRound ?? 0;
      (map[r] ||= []).push(m);
    }
    return Object.entries(map)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([r, ms]) => ({ round: Number(r), matches: ms }));
  }, [stage]);

  const hintByRound: Record<number, Record<string, string | undefined>> = useMemo(() => {
    const out: Record<number, Record<string, string | undefined>> = {};
    if (!pickem) return out;
    for (const p of pickem.picks) {
      if (p.kind !== "PLAYOFF_WINNER" || p.round == null) continue;
      out[p.round] ||= {};
      out[p.round][p.teamId] = p.round === 4 ? "CHAMP" : "WIN";
    }
    return out;
  }, [pickem]);

  return (
    <section className="rounded-2xl border border-line bg-panel p-4">
      <h2 className="mb-3 text-lg font-semibold">{stage.name}</h2>
      <div className="flex gap-6 overflow-x-auto">
        {rounds.map((col) => (
          <div key={col.round} className="flex min-w-[240px] flex-1 flex-col gap-3">
            <div className="text-xs font-semibold uppercase text-muted">
              {ROUND_LABELS[col.round] ?? `Round ${col.round}`}
            </div>
            <div
              className="flex flex-col gap-4"
              style={{ marginTop: col.round > 1 ? `${(col.round - 1) * 20}px` : 0 }}
            >
              {col.matches.map((m) => (
                <MatchCard
                  key={m.id}
                  match={m}
                  effectiveWinnerId={effectiveWinner(m, overrides)}
                  onPick={setOverride}
                  pickHints={hintByRound[col.round]}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
