"use client";
import { useMemo, useState } from "react";
import { STAGE_LABEL, type ClientMatch, type ClientPickem, type ClientStage, type ClientTeam, type ClientTournament } from "@/lib/types";
import { effectiveWinner, type ScoreLine, type WinnerOverrides } from "@/lib/scoring";
import { MatchCard } from "./MatchCard";

// Mini playoff bracket rendered with a fixed CSS-grid layout so QF/SF/Final
// columns align like a real single-elimination bracket (Liquipedia style):
//
//   QF1 ┐
//        ├─ SF1 ┐
//   QF2 ┘       │
//                ├─ Final
//   QF3 ┐       │
//        ├─ SF2 ┘
//   QF4 ┘
//
// Each row in the CSS grid is one "QF slot" tall. QFs occupy 1 row, SFs
// span 2 rows centered over their two feeders, the Final spans all 4 rows.
//
// Progression rule: a team only appears in an SF/Final slot once its
// feeder match is FINISHED (or simulated via overrides). A QF that's still
// LIVE / PENDING does NOT advance its leading team — we wait for the full
// Bo3 to conclude. This is intentional: it mirrors how IRL brackets
// display TBD until each round resolves.

const ROUND_LABELS: Record<number, string> = {
  1: "Quarter-finals",
  2: "Semi-finals",
  3: "Grand Final",
};

const QF_COUNT = 4;
const ROW_GUTTER = 16;
const COLUMN_GAP = 32;
const COLUMN_WIDTHS = { qf: 220, sf: 220, final: 240 } as const;

export function PlayoffBracket({
  stage,
  overrides,
  setOverride,
  pickem,
  tournament,
}: {
  stage: ClientStage;
  overrides: WinnerOverrides;
  setOverride: (matchId: string, teamId: string | null) => void;
  pickem: ClientPickem | null;
  // Kept for API compatibility — currently unused, PickSummary is no longer
  // rendered inside this bracket (the per-stage pick chip list was noisy and
  // duplicated info shown elsewhere).
  score: ScoreLine | null;
  tournament?: ClientTournament;
}) {
  // Bucket and order matches by round + slot. We rely on bracketSlot for
  // stable visual ordering — DB insertion order is meaningless here.
  const { qfs, sfs, finalMatch } = useMemo(() => {
    const byRound: Record<number, ClientMatch[]> = {};
    for (const m of stage.matches) {
      const r = m.bracketRound ?? 0;
      (byRound[r] ||= []).push(m);
    }
    const bySlot = (a: ClientMatch, b: ClientMatch) =>
      (a.bracketSlot ?? 99) - (b.bracketSlot ?? 99);
    const qfsRaw = (byRound[1] ?? []).slice().sort(bySlot).slice(0, QF_COUNT);
    while (qfsRaw.length < QF_COUNT) qfsRaw.push(null as unknown as ClientMatch);
    const sfsRaw = (byRound[2] ?? []).slice().sort(bySlot).slice(0, 2);
    while (sfsRaw.length < 2) sfsRaw.push(null as unknown as ClientMatch);
    const finalRaw = (byRound[3] ?? [])[0] ?? null;
    return { qfs: qfsRaw, sfs: sfsRaw, finalMatch: finalRaw };
  }, [stage]);

  // For each QF, resolve the team that should advance to its SF slot —
  // either the real FINISHED winner, or a user-simulated override.
  // Returns null if the match is still LIVE/PENDING with no override.
  function advancingTeamId(m: ClientMatch | null): string | null {
    if (!m) return null;
    if (overrides[m.id] !== undefined) return overrides[m.id];
    if (m.status !== "FINISHED") return null;
    return m.winnerId;
  }

  const teamsById = useMemo(() => {
    const m = new Map<string, ClientTeam>();
    for (const t of stage.teams) m.set(t.id, t);
    return m;
  }, [stage.teams]);

  // Compute derived SF/Final pairings from feeder winners. We construct a
  // "shadow" match object that mirrors the stored SF row but with teamA/teamB
  // taken from the feeders. Identity (match.id) stays the same so MatchCard
  // simulation overrides still key correctly.
  function shadowedSF(sf: ClientMatch | null, feederA: ClientMatch | null, feederB: ClientMatch | null): ClientMatch | null {
    if (!sf) return null;
    const aId = advancingTeamId(feederA);
    const bId = advancingTeamId(feederB);
    return {
      ...sf,
      teamA: aId ? teamsById.get(aId) ?? null : null,
      teamB: bId ? teamsById.get(bId) ?? null : null,
    };
  }

  const sf1 = shadowedSF(sfs[0], qfs[0], qfs[1]);
  const sf2 = shadowedSF(sfs[1], qfs[2], qfs[3]);
  const finalShadow = shadowedSF(finalMatch, sf1, sf2);

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

  const [collapsed, setCollapsed] = useState(false);

  return (
    <section className="rounded-2xl border border-line bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{STAGE_LABEL[stage.kind]}</h2>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="rounded border border-line bg-panel2 px-2 py-1 text-xs text-muted hover:text-text"
          aria-expanded={!collapsed}
        >
          {collapsed ? "Show bracket" : "Hide bracket"}
        </button>
      </div>
      {!collapsed && (
        <div className="overflow-x-auto pb-2">
          <div className="min-w-[760px]">
            <div
              className="mb-2 grid text-[11px] font-semibold uppercase tracking-wide text-muted"
              style={{
                gridTemplateColumns: `${COLUMN_WIDTHS.qf}px ${COLUMN_WIDTHS.sf}px ${COLUMN_WIDTHS.final}px`,
                columnGap: `${COLUMN_GAP}px`,
              }}
            >
              <div>{ROUND_LABELS[1]}</div>
              <div>{ROUND_LABELS[2]}</div>
              <div>{ROUND_LABELS[3]}</div>
            </div>

            <div
              className="grid"
              style={{
                gridTemplateColumns: `${COLUMN_WIDTHS.qf}px ${COLUMN_WIDTHS.sf}px ${COLUMN_WIDTHS.final}px`,
                gridTemplateRows: `repeat(${QF_COUNT}, minmax(0, 1fr))`,
                columnGap: `${COLUMN_GAP}px`,
                rowGap: `${ROW_GUTTER}px`,
              }}
            >
              {qfs.map((m, i) => (
                <div
                  key={`qf-${i}`}
                  style={{ gridColumn: 1, gridRow: i + 1 }}
                  className="flex items-center"
                >
                  <BracketSlot
                    match={m}
                    overrides={overrides}
                    setOverride={setOverride}
                    pickHints={hintByRound[1]}
                    tournament={tournament}
                  />
                </div>
              ))}

              {[sf1, sf2].map((m, i) => (
                <div
                  key={`sf-${i}`}
                  style={{ gridColumn: 2, gridRow: `${i * 2 + 1} / span 2` }}
                  className="flex items-center"
                >
                  <BracketSlot
                    match={m}
                    overrides={overrides}
                    setOverride={setOverride}
                    pickHints={hintByRound[2]}
                    tournament={tournament}
                  />
                </div>
              ))}

              <div
                style={{ gridColumn: 3, gridRow: `1 / span ${QF_COUNT}` }}
                className="flex items-center"
              >
                <BracketSlot
                  match={finalShadow}
                  overrides={overrides}
                  setOverride={setOverride}
                  pickHints={hintByRound[3]}
                  tournament={tournament}
                  championHint={hintByRound[4]}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function BracketSlot({
  match,
  overrides,
  setOverride,
  pickHints,
  tournament,
  championHint,
}: {
  match: ClientMatch | null;
  overrides: WinnerOverrides;
  setOverride: (matchId: string, teamId: string | null) => void;
  pickHints?: { [teamId: string]: string | undefined };
  tournament?: ClientTournament;
  championHint?: { [teamId: string]: string | undefined };
}) {
  if (!match) {
    return (
      <div className="flex h-[68px] w-full items-center justify-center rounded-lg border border-dashed border-line bg-panel2/40 text-xs text-muted">
        TBD
      </div>
    );
  }
  const mergedHints = { ...(pickHints ?? {}), ...(championHint ?? {}) };
  return (
    <div className="w-full">
      <MatchCard
        match={match}
        effectiveWinnerId={effectiveWinner(match, overrides)}
        onPick={setOverride}
        pickHints={mergedHints}
        tournament={tournament}
      />
    </div>
  );
}
