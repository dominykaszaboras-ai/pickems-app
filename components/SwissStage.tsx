"use client";
import { useMemo } from "react";
import type { ClientPickem, ClientStage, ClientTeam } from "@/lib/types";
import { computeSwissStandings, effectiveWinner, type ScoreLine, type WinnerOverrides } from "@/lib/scoring";
import { MatchCard } from "./MatchCard";
import { TeamLogo } from "./TeamLogo";
import { PickSummary } from "./PickSummary";

export function SwissStage({
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
  // Group matches by swissRound for column display.
  const rounds = useMemo(() => {
    const map: Record<number, typeof stage.matches> = {};
    for (const m of stage.matches) {
      const r = m.swissRound ?? 0;
      (map[r] ||= []).push(m);
    }
    return Object.entries(map)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([r, ms]) => ({ round: Number(r), matches: ms }));
  }, [stage]);

  const standings = useMemo(() => computeSwissStandings(stage, overrides), [stage, overrides]);
  const teamRow = (id: string) => standings.get(id);

  // Set of teamIds the user actually picked in this stage. Used to draw a
  // subtle "you picked this" border on the standings row + match card row.
  // Deliberately NOT the same styling as "advanced/eliminated" — the previous
  // bracket conflated the two and made it look like every advancing team had
  // been picked.
  const userPickedIds = useMemo(() => {
    const set = new Set<string>();
    if (!pickem) return set;
    for (const p of pickem.picks) {
      if (p.stageKind === stage.kind) set.add(p.teamId);
    }
    return set;
  }, [pickem, stage.kind]);

  // Pick hints for the MatchCard rows: which kind did the user pick this
  // team for in THIS stage? Only set for teams the user actually picked.
  const hints: Record<string, string | undefined> = useMemo(() => {
    const out: Record<string, string | undefined> = {};
    if (!pickem) return out;
    for (const p of pickem.picks) {
      if (p.stageKind !== stage.kind) continue;
      if (p.kind === "SWISS_3_0") out[p.teamId] = "3-0";
      else if (p.kind === "SWISS_0_3") out[p.teamId] = "0-3";
      else if (p.kind === "SWISS_ADVANCE") out[p.teamId] = "ADV";
    }
    return out;
  }, [pickem, stage.kind]);

  // Team lookup map for PickSummary.
  const teamsById = useMemo(() => {
    const m = new Map<string, ClientTeam>();
    for (const t of stage.teams) m.set(t.id, t);
    return m;
  }, [stage.teams]);

  return (
    <section className="rounded-2xl border border-line bg-panel p-4">
      <h2 className="mb-3 text-lg font-semibold">{stage.name}</h2>

      {/* Your picks first — single source of truth for what scored what */}
      <div className="mb-4">
        <PickSummary stage={stage} score={score} teamsById={teamsById} />
      </div>

      <div className="flex gap-4 overflow-x-auto">
        {rounds.map((col) => (
          <div key={col.round} className="min-w-[220px] flex-1">
            <div className="mb-2 text-xs font-semibold uppercase text-muted">Round {col.round}</div>
            <div className="flex flex-col gap-2">
              {col.matches.map((m) => (
                <MatchCard
                  key={m.id}
                  match={m}
                  effectiveWinnerId={effectiveWinner(m, overrides)}
                  onPick={setOverride}
                  pickHints={hints}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5">
        <h3 className="mb-2 text-xs font-semibold uppercase text-muted">
          Standings (live + simulated)
        </h3>
        <p className="mb-2 text-[10px] text-muted">
          These are real results, not your picks. Teams you picked have a dotted ring;
          see <span className="text-text">Your picks</span> above for correctness.
        </p>
        <div className="grid grid-cols-2 gap-1 text-sm md:grid-cols-4">
          {[...standings.values()]
            .sort((a, b) => b.wins - a.wins || a.losses - b.losses)
            .map((s) => {
              const team = stage.matches
                .flatMap((m) => [m.teamA, m.teamB])
                .find((t) => t?.id === s.teamId);
              if (!team) return null;
              const wasPicked = userPickedIds.has(team.id);
              return (
                <div
                  key={s.teamId}
                  className={
                    "flex items-center gap-2 rounded border border-line bg-panel2 p-1.5 " +
                    (s.status === "ELIMINATED" ? "opacity-60 " : "") +
                    (wasPicked ? "ring-1 ring-dashed ring-accent/60 " : "")
                  }
                >
                  <TeamLogo team={team} size={18} />
                  <span className="flex-1 truncate text-xs">{team.name}</span>
                  <span className="font-mono text-xs text-muted">
                    {s.wins}-{s.losses}
                  </span>
                </div>
              );
            })}
        </div>
      </div>
    </section>
  );
}
