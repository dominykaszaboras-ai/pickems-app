"use client";

// Read-only mini-bracket that visualizes the user's playoff picks instead
// of dumping them in a flat list. Same layout convention as the editable
// PlayoffBracketPicker (QF on left, then SF, then Final + Champion) but
// scored: each cell is tinted by the pick's correct/wrong/pending state
// straight from scorePickem.pickResults.
//
// Used by PickSummary when stage.kind === "PLAYOFFS". Swiss stages keep
// the existing chip list because they don't have a tree structure.

import clsx from "clsx";
import type { ClientMatch, ClientStage, ClientTeam } from "@/lib/types";
import type { ScoreLine } from "@/lib/scoring";
import { TeamLogo } from "./TeamLogo";

interface PickResult {
  round: number | null;
  teamId: string;
  correct: boolean | null; // null = stage not concluded yet
  points: number;
}

export function PlayoffPickBracket({
  stage,
  score,
  teamsById,
}: {
  stage: ClientStage;
  score: ScoreLine;
  teamsById: Map<string, ClientTeam>;
}) {
  // Same QF sort as PlayoffBracketPicker: bracketSlot when present, else
  // startTime. Limit to 4 so SF/Final rows in the DB don't bleed in.
  const qfMatches: ClientMatch[] = [...stage.matches]
    .filter((m) => m.teamA && m.teamB)
    .sort((a, b) => {
      if (a.bracketSlot != null && b.bracketSlot != null) {
        return a.bracketSlot - b.bracketSlot;
      }
      const ta = a.startTime ? Date.parse(a.startTime) : 0;
      const tb = b.startTime ? Date.parse(b.startTime) : 0;
      return ta - tb;
    })
    .slice(0, 4);

  if (qfMatches.length === 0) {
    return null;
  }

  const playoffPicks = score.pickResults.filter(
    (p) => p.stageKind === "PLAYOFFS" && p.kind === "PLAYOFF_WINNER",
  );

  // Build QF winner -> match map by matching the user's round=1 picks
  // against each match's two teams.
  const qfPickByMatchId: Record<string, PickResult | null> = {};
  for (const m of qfMatches) {
    const aId = m.teamA!.id;
    const bId = m.teamB!.id;
    const hit = playoffPicks.find(
      (p) => p.round === 1 && (p.teamId === aId || p.teamId === bId),
    );
    qfPickByMatchId[m.id] = hit ?? null;
  }

  // SF pairings derive from QF picks: sf1 = (QF1 winner, QF2 winner),
  // sf2 = (QF3 winner, QF4 winner). Each pairing renders as a "match"
  // with the two QF winners as candidates.
  const sfPairings = [
    {
      slot: "sf1" as const,
      a: qfPickByMatchId[qfMatches[0]?.id]?.teamId,
      b: qfPickByMatchId[qfMatches[1]?.id]?.teamId,
    },
    {
      slot: "sf2" as const,
      a: qfPickByMatchId[qfMatches[2]?.id]?.teamId,
      b: qfPickByMatchId[qfMatches[3]?.id]?.teamId,
    },
  ];

  const sfPickBySlot: Record<"sf1" | "sf2", PickResult | null> = {
    sf1: null,
    sf2: null,
  };
  for (const pairing of sfPairings) {
    const candidates = [pairing.a, pairing.b].filter(Boolean) as string[];
    if (candidates.length === 0) continue;
    const hit = playoffPicks.find(
      (p) => p.round === 2 && candidates.includes(p.teamId),
    );
    sfPickBySlot[pairing.slot] = hit ?? null;
  }

  // Final/Champion. Round=3 is the Final match winner, round=4 mirrors
  // it (Champion) — we render the Champion cell from whichever is set.
  const finalCandidates = [sfPickBySlot.sf1?.teamId, sfPickBySlot.sf2?.teamId].filter(
    Boolean,
  ) as string[];
  const finalPick = playoffPicks.find(
    (p) => p.round === 3 && finalCandidates.includes(p.teamId),
  ) ?? null;
  const championPick =
    playoffPicks.find((p) => p.round === 4) ?? finalPick;

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-panel2/60 p-3">
      <div className="flex gap-4">
        <Column title="QF">
          <div className="flex flex-col gap-2">
            {qfMatches.map((m) => (
              <PickTile
                key={m.id}
                pickedTeam={
                  qfPickByMatchId[m.id]
                    ? teamsById.get(qfPickByMatchId[m.id]!.teamId) ?? null
                    : null
                }
                correct={qfPickByMatchId[m.id]?.correct ?? null}
                placeholder={`${m.teamA?.name ?? "?"} v ${m.teamB?.name ?? "?"}`}
              />
            ))}
          </div>
        </Column>

        <Column title="SF">
          <div className="flex flex-col gap-[26px] pt-[16px]">
            {sfPairings.map((p) => (
              <PickTile
                key={p.slot}
                pickedTeam={
                  sfPickBySlot[p.slot]
                    ? teamsById.get(sfPickBySlot[p.slot]!.teamId) ?? null
                    : null
                }
                correct={sfPickBySlot[p.slot]?.correct ?? null}
                placeholder="—"
              />
            ))}
          </div>
        </Column>

        <Column title="Final">
          <div className="flex flex-col gap-2 pt-[68px]">
            <PickTile
              pickedTeam={
                finalPick ? teamsById.get(finalPick.teamId) ?? null : null
              }
              correct={finalPick?.correct ?? null}
              placeholder="—"
            />
          </div>
        </Column>

        <Column title="Champion">
          <div className="flex flex-col gap-2 pt-[68px]">
            <PickTile
              pickedTeam={
                championPick
                  ? teamsById.get(championPick.teamId) ?? null
                  : null
              }
              correct={championPick?.correct ?? null}
              placeholder="—"
              highlight
            />
          </div>
        </Column>
      </div>
    </div>
  );
}

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-[120px] flex-col">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-muted">
        {title}
      </div>
      {children}
    </div>
  );
}

function PickTile({
  pickedTeam,
  correct,
  placeholder,
  highlight = false,
}: {
  pickedTeam: ClientTeam | null;
  correct: boolean | null;
  placeholder?: string;
  highlight?: boolean;
}) {
  if (!pickedTeam) {
    return (
      <div className="flex h-9 items-center rounded-md border border-dashed border-line bg-panel/40 px-2 text-[10px] text-muted">
        <span className="truncate">{placeholder ?? "—"}</span>
      </div>
    );
  }
  return (
    <div
      className={clsx(
        "flex h-9 items-center gap-2 rounded-md border px-2 text-xs",
        correct === true && "border-win/60 bg-win/10",
        correct === false && "border-loss/60 bg-loss/10 opacity-80",
        correct === null && "border-line bg-panel/60",
        highlight && correct !== false && "ring-1 ring-inset ring-accent/40",
      )}
    >
      <TeamLogo team={pickedTeam} size={18} />
      <span className="truncate font-medium">{pickedTeam.name}</span>
      {correct === true && (
        <span className="ml-auto font-mono text-[10px] text-win">✓</span>
      )}
      {correct === false && (
        <span className="ml-auto text-[10px] text-loss">✗</span>
      )}
      {correct === null && (
        <span className="ml-auto text-[10px] text-muted">…</span>
      )}
    </div>
  );
}
