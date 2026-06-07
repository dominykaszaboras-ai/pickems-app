"use client";
// Renders the user's picks for a given stage with correct/wrong/pending
// status straight from scorePickem.pickResults. This is the authoritative
// place to see what you actually picked and how each pick scored — the
// standings rows on the bracket are just real-life results, NOT your picks.

import clsx from "clsx";
import type { ClientStage, ClientTeam, StageKind } from "@/lib/types";
import type { ScoreLine } from "@/lib/scoring";
import { TeamLogo } from "./TeamLogo";

const KIND_LABEL: Record<string, string> = {
  SWISS_3_0: "3-0",
  SWISS_0_3: "0-3",
  SWISS_ADVANCE: "ADV",
  PLAYOFF_WINNER: "WIN",
};

export function PickSummary({
  stage,
  score,
  teamsById,
}: {
  stage: ClientStage;
  score: ScoreLine | null;
  teamsById: Map<string, ClientTeam>;
}) {
  if (!score) return null;
  const picksForStage = score.pickResults.filter((p) => p.stageKind === stage.kind);
  if (picksForStage.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-panel/40 p-3 text-xs text-muted">
        You haven't picked anything for this stage yet —{" "}
        <a className="text-accent underline" href="/pickems">submit picks</a>.
      </div>
    );
  }

  // Group by pick kind for clarity.
  const groups: Record<string, typeof picksForStage> = {};
  for (const p of picksForStage) {
    (groups[p.kind] ||= []).push(p);
  }

  const order = ["SWISS_3_0", "SWISS_ADVANCE", "SWISS_0_3", "PLAYOFF_WINNER"];
  const stageTotal = picksForStage.reduce((sum, p) => sum + p.points, 0);

  return (
    <div className="rounded-xl border border-line bg-panel2/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase text-muted">Your picks</div>
        <div className="font-mono text-sm">
          <span className="text-accent">{stageTotal}</span>
          <span className="text-muted"> pts this stage</span>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {order
          .filter((k) => groups[k])
          .map((k) => (
            <div key={k} className="flex flex-wrap items-center gap-2">
              <span className="w-10 text-[10px] font-bold uppercase text-muted">
                {KIND_LABEL[k]}
              </span>
              {groups[k].map((p) => {
                const team = teamsById.get(p.teamId);
                return (
                  <div
                    key={p.teamId + ":" + (p.round ?? 0)}
                    className={clsx(
                      "flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-xs",
                      p.correct === true && "border-win/60 bg-win/10",
                      p.correct === false && "border-loss/60 bg-loss/10 opacity-80",
                      p.correct === null && "border-line bg-panel/60",
                    )}
                  >
                    <TeamLogo team={team ?? null} size={14} />
                    <span className="truncate max-w-[100px]">{team?.name ?? "?"}</span>
                    {p.correct === true && (
                      <span className="font-mono text-win">+{p.points}</span>
                    )}
                    {p.correct === false && <span className="text-loss">✗</span>}
                    {p.correct === null && <span className="text-muted">…</span>}
                  </div>
                );
              })}
            </div>
          ))}
      </div>
    </div>
  );
}
