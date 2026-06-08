"use client";
import { useMemo, useState } from "react";
import type { ClientPickem, ClientStage, ClientTeam } from "@/lib/types";
import { effectiveWinner, type ScoreLine, type WinnerOverrides } from "@/lib/scoring";
import { MatchCard } from "./MatchCard";
import { PickSummary } from "./PickSummary";

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
  score,
}: {
  stage: ClientStage;
  overrides: WinnerOverrides;
  setOverride: (matchId: string, teamId: string | null) => void;
  pickem: ClientPickem | null;
  score: ScoreLine | null;
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

  const teamsById = useMemo(() => {
    const m = new Map<string, ClientTeam>();
    for (const t of stage.teams) m.set(t.id, t);
    return m;
  }, [stage.teams]);

  const [collapsed, setCollapsed] = useState(false);

  return (
    <section className="rounded-2xl border border-line bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{stage.name}</h2>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="rounded border border-line bg-panel2 px-2 py-1 text-xs text-muted hover:text-text"
          aria-expanded={!collapsed}
        >
          {collapsed ? "Show bracket" : "Hide bracket"}
        </button>
      </div>
      <div className="mb-4">
        <PickSummary stage={stage} score={score} teamsById={teamsById} />
      </div>
      {!collapsed && (
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
      )}
    </section>
  );
}
