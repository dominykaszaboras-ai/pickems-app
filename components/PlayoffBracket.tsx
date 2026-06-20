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

  // Index the viewer's playoff picks by round so we can use them as
  // fallback "ghost" teams in SF/Final cells when the feeder match
  // hasn't decided yet. This is purely visual — the actual scoring still
  // gates on `advancingTeamId` (real winner OR sim override).
  const playoffPicksByRound = useMemo(() => {
    const map = new Map<number, Set<string>>();
    for (const p of pickem?.picks ?? []) {
      if (p.kind !== "PLAYOFF_WINNER" || p.round == null) continue;
      if (!map.has(p.round)) map.set(p.round, new Set());
      map.get(p.round)!.add(p.teamId);
    }
    return map;
  }, [pickem]);

  // The user's pick for a given feeder match: which of the two teams in
  // `feeder` did they pick to win round `round`? Returns null if none.
  function userPickForFeeder(feeder: ClientMatch | null, round: number): string | null {
    if (!feeder) return null;
    const picks = playoffPicksByRound.get(round);
    if (!picks) return null;
    if (feeder.teamA && picks.has(feeder.teamA.id)) return feeder.teamA.id;
    if (feeder.teamB && picks.has(feeder.teamB.id)) return feeder.teamB.id;
    return null;
  }

  // Compute derived SF/Final pairings from feeder winners. We construct a
  // "shadow" match object that mirrors the stored SF row but with teamA/teamB
  // taken from the feeders. When the feeder is still undecided we fall
  // back to the user's pick so the bracket renders their predicted path —
  // the pickHints layer below will tag it with WIN/CHAMP.
  // Identity (match.id) stays the same so MatchCard simulation overrides
  // still key correctly.
  function shadowedRound(
    self: ClientMatch | null,
    feederA: ClientMatch | null,
    feederB: ClientMatch | null,
    feederRound: number,
  ): ClientMatch | null {
    if (!self) return null;
    const aId = advancingTeamId(feederA) ?? userPickForFeeder(feederA, feederRound);
    const bId = advancingTeamId(feederB) ?? userPickForFeeder(feederB, feederRound);
    return {
      ...self,
      teamA: aId ? teamsById.get(aId) ?? null : null,
      teamB: bId ? teamsById.get(bId) ?? null : null,
    };
  }

  const sf1 = shadowedRound(sfs[0], qfs[0], qfs[1], 1);
  const sf2 = shadowedRound(sfs[1], qfs[2], qfs[3], 1);
  const finalShadow = shadowedRound(finalMatch, sf1, sf2, 2);

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
              className="relative grid"
              style={{
                gridTemplateColumns: `${COLUMN_WIDTHS.qf}px ${COLUMN_WIDTHS.sf}px ${COLUMN_WIDTHS.final}px`,
                gridTemplateRows: `repeat(${QF_COUNT}, minmax(0, 1fr))`,
                columnGap: `${COLUMN_GAP}px`,
                rowGap: `${ROW_GUTTER}px`,
              }}
            >
              <BracketConnectors />
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

// SVG overlay that draws the Liquipedia-style connector lines between
// QF→SF and SF→Final. Positioned absolute over the grid; pointer-events
// off so it doesn't intercept clicks on the match cards underneath.
//
// Coordinates use percentages with preserveAspectRatio=none so the lines
// scale with the grid. `vectorEffect="non-scaling-stroke"` keeps the
// stroke 1px regardless of scaling.
function BracketConnectors() {
  // Horizontal anchors expressed as a fraction of the grid width.
  // (Must stay in sync with COLUMN_WIDTHS + COLUMN_GAP above.)
  const totalW = COLUMN_WIDTHS.qf + COLUMN_GAP + COLUMN_WIDTHS.sf + COLUMN_GAP + COLUMN_WIDTHS.final;
  const qfRight = (COLUMN_WIDTHS.qf / totalW) * 100;
  const sfLeft = ((COLUMN_WIDTHS.qf + COLUMN_GAP) / totalW) * 100;
  const sfRight = ((COLUMN_WIDTHS.qf + COLUMN_GAP + COLUMN_WIDTHS.sf) / totalW) * 100;
  const finalLeft = ((COLUMN_WIDTHS.qf + COLUMN_GAP + COLUMN_WIDTHS.sf + COLUMN_GAP) / totalW) * 100;
  const qfSfMid = (qfRight + sfLeft) / 2;
  const sfFinalMid = (sfRight + finalLeft) / 2;

  // Vertical anchors: QF rows centered at 12.5/37.5/62.5/87.5%, SFs at
  // 25/75%, Final at 50%.
  const qfYs = [12.5, 37.5, 62.5, 87.5];
  const sfYs = [25, 75];
  const finalY = 50;

  const stroke = "currentColor";
  const sw = 1;

  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full text-line"
      preserveAspectRatio="none"
      viewBox="0 0 100 100"
    >
      {/* QF → SF connectors. Each SF is fed by two QFs above/below it. */}
      {sfYs.map((sfY, sfIdx) => {
        const topQf = qfYs[sfIdx * 2];
        const bottomQf = qfYs[sfIdx * 2 + 1];
        return (
          <g key={`qf-sf-${sfIdx}`}>
            <line x1={qfRight} y1={topQf} x2={qfSfMid} y2={topQf} stroke={stroke} strokeWidth={sw} vectorEffect="non-scaling-stroke" />
            <line x1={qfRight} y1={bottomQf} x2={qfSfMid} y2={bottomQf} stroke={stroke} strokeWidth={sw} vectorEffect="non-scaling-stroke" />
            <line x1={qfSfMid} y1={topQf} x2={qfSfMid} y2={bottomQf} stroke={stroke} strokeWidth={sw} vectorEffect="non-scaling-stroke" />
            <line x1={qfSfMid} y1={sfY} x2={sfLeft} y2={sfY} stroke={stroke} strokeWidth={sw} vectorEffect="non-scaling-stroke" />
          </g>
        );
      })}
      {/* SF → Final */}
      <g>
        <line x1={sfRight} y1={sfYs[0]} x2={sfFinalMid} y2={sfYs[0]} stroke={stroke} strokeWidth={sw} vectorEffect="non-scaling-stroke" />
        <line x1={sfRight} y1={sfYs[1]} x2={sfFinalMid} y2={sfYs[1]} stroke={stroke} strokeWidth={sw} vectorEffect="non-scaling-stroke" />
        <line x1={sfFinalMid} y1={sfYs[0]} x2={sfFinalMid} y2={sfYs[1]} stroke={stroke} strokeWidth={sw} vectorEffect="non-scaling-stroke" />
        <line x1={sfFinalMid} y1={finalY} x2={finalLeft} y2={finalY} stroke={stroke} strokeWidth={sw} vectorEffect="non-scaling-stroke" />
      </g>
    </svg>
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
