"use client";

// Bracket-style playoff picker. Mirrors how CS2's in-game pickem UI works:
// the 4 QF matchups stack as the left column, each click on a team advances
// them to the SF column. SF candidates derive from QF picks (SF1 = winner of
// QF1 vs winner of QF2; SF2 = winner of QF3 vs winner of QF4). Same cascade
// to the Final. The Final winner is automatically the Champion pick (we
// emit both round=3 and round=4 PickemPick rows so existing scoring keeps
// working).
//
// The component is CONTROLLED — it has no internal state. Derived shape:
//   picks: Array<{round, teamId}>
//   round=1 -> QF winners (max 4)
//   round=2 -> SF winners (max 2)
//   round=3 -> Final winner (max 1)
//   round=4 -> Champion = same team as round=3
//
// Click-to-advance is the primary interaction (works on mobile + keyboard).
// We also wire HTML5 drag-and-drop on each team logo so dragging a logo onto
// the same match's other side acts as the same "I pick this team" gesture —
// keeps the CS2-feel without needing a drag library.

import { useMemo } from "react";
import clsx from "clsx";
import type { ClientMatch, ClientTeam } from "@/lib/types";
import type { ScoreLine } from "@/lib/scoring";
import { TeamLogo } from "./TeamLogo";

export interface PlayoffPick {
  round: number;
  teamId: string;
}

type Slot = "sf1" | "sf2";

export function PlayoffBracketPicker({
  playoffMatches,
  picks,
  setPicks,
  pickResults,
}: {
  playoffMatches: ClientMatch[];
  picks: PlayoffPick[];
  setPicks: (p: PlayoffPick[]) => void;
  // Per-pick correctness for the user's SAVED picks. Used to tint each row
  // green/red once results land. Empty when the user has no submitted
  // picks yet (so the picker stays neutral while they're filling it in).
  pickResults?: ScoreLine["pickResults"];
}) {
  // Sort QF matches in bracket order. Liquipedia-sourced rows don't carry
  // bracketSlot, so we fall back to startTime ascending. Limit to 4 so a
  // stray SF/Final row in the same `playoffMatches` array doesn't bleed in.
  const qfSorted = useMemo(
    () =>
      [...playoffMatches]
        .filter((m) => (m.bracketRound == null || m.bracketRound === 1) && m.teamA && m.teamB)
        .sort((a, b) => {
          if (a.bracketSlot != null && b.bracketSlot != null) {
            return a.bracketSlot - b.bracketSlot;
          }
          const ta = a.startTime ? Date.parse(a.startTime) : 0;
          const tb = b.startTime ? Date.parse(b.startTime) : 0;
          return ta - tb;
        })
        .slice(0, 4),
    [playoffMatches],
  );

  // Look up SF1 / SF2 / Final DB rows so we can lock the corresponding picker
  // rows when those matches FINISH. Keyed by bracketRound + bracketSlot.
  const sfMatchBySlot = useMemo(() => {
    const out: Record<Slot, ClientMatch | null> = { sf1: null, sf2: null };
    for (const m of playoffMatches) {
      if (m.bracketRound !== 2) continue;
      if (m.bracketSlot === 1) out.sf1 = m;
      else if (m.bracketSlot === 2) out.sf2 = m;
    }
    return out;
  }, [playoffMatches]);
  const finalMatch = useMemo(
    () => playoffMatches.find((m) => m.bracketRound === 3) ?? null,
    [playoffMatches],
  );

  // Correctness lookup keyed by `${round}:${teamId}` — built from the saved
  // pickem's scoring output. `true` = pick landed, `false` = busted (team
  // eliminated or lost), null/undefined = still in flight.
  const correctByPick = useMemo(() => {
    const out = new Map<string, boolean | null>();
    for (const r of pickResults ?? []) {
      if (r.kind !== "PLAYOFF_WINNER" || r.round == null) continue;
      out.set(`${r.round}:${r.teamId}`, r.correct);
    }
    return out;
  }, [pickResults]);
  function correctnessFor(round: number, teamId: string | null | undefined): boolean | null {
    if (!teamId) return null;
    return correctByPick.get(`${round}:${teamId}`) ?? null;
  }

  // ---- Derived state ----------------------------------------------------

  const qfWinnerByMatchId: Record<string, string | null> = useMemo(() => {
    const out: Record<string, string | null> = {};
    for (const m of qfSorted) {
      const aId = m.teamA!.id;
      const bId = m.teamB!.id;
      const winner =
        picks.find((p) => p.round === 1 && (p.teamId === aId || p.teamId === bId))
          ?.teamId ?? null;
      out[m.id] = winner;
    }
    return out;
  }, [qfSorted, picks]);

  // SF pairings: sf1 = (QF1, QF2 winners), sf2 = (QF3, QF4 winners)
  const sfPairings: Array<{ slot: Slot; a: ClientTeam | null; b: ClientTeam | null }> =
    useMemo(() => {
      const w = (i: number): ClientTeam | null => {
        const m = qfSorted[i];
        if (!m) return null;
        const wId = qfWinnerByMatchId[m.id];
        if (!wId) return null;
        return wId === m.teamA!.id ? m.teamA : wId === m.teamB!.id ? m.teamB : null;
      };
      return [
        { slot: "sf1", a: w(0), b: w(1) },
        { slot: "sf2", a: w(2), b: w(3) },
      ];
    }, [qfSorted, qfWinnerByMatchId]);

  const sfWinnerBySlot: Record<Slot, string | null> = useMemo(() => {
    const out: Record<Slot, string | null> = { sf1: null, sf2: null };
    for (const pairing of sfPairings) {
      const candidates = [pairing.a?.id, pairing.b?.id].filter(Boolean) as string[];
      const winner = picks.find(
        (p) => p.round === 2 && candidates.includes(p.teamId),
      );
      out[pairing.slot] = winner?.teamId ?? null;
    }
    return out;
  }, [picks, sfPairings]);

  const finalPair: { a: ClientTeam | null; b: ClientTeam | null } = useMemo(() => {
    const lookup = (id: string | null): ClientTeam | null => {
      if (!id) return null;
      for (const p of sfPairings) {
        if (p.a?.id === id) return p.a;
        if (p.b?.id === id) return p.b;
      }
      return null;
    };
    return { a: lookup(sfWinnerBySlot.sf1), b: lookup(sfWinnerBySlot.sf2) };
  }, [sfPairings, sfWinnerBySlot]);

  const finalWinnerId: string | null = useMemo(() => {
    const candidates = [finalPair.a?.id, finalPair.b?.id].filter(Boolean) as string[];
    if (!candidates.length) return null;
    return (
      picks.find((p) => p.round === 3 && candidates.includes(p.teamId))?.teamId ?? null
    );
  }, [picks, finalPair]);

  const finalWinnerTeam: ClientTeam | null = useMemo(() => {
    if (!finalWinnerId) return null;
    if (finalPair.a?.id === finalWinnerId) return finalPair.a;
    if (finalPair.b?.id === finalWinnerId) return finalPair.b;
    return null;
  }, [finalWinnerId, finalPair]);

  // ---- Mutations --------------------------------------------------------

  // The core trick: every mutation REBUILDS the full picks list from a
  // consistent triple { qf, sf, final }, so we can't accumulate orphans
  // when the user changes a QF and downstream picks become stale.

  function rebuild(
    nextQf: Record<string, string | null>,
    nextSf: Record<Slot, string | null>,
    nextFinal: string | null,
  ) {
    // Recompute SF candidates from the new QF and drop SF winners that
    // are no longer candidates.
    const sfClean: Record<Slot, string | null> = { sf1: null, sf2: null };
    for (const [slot, idxs] of [
      ["sf1", [0, 1]],
      ["sf2", [2, 3]],
    ] as const) {
      const candidates = idxs
        .map((i) => qfSorted[i] && nextQf[qfSorted[i].id])
        .filter(Boolean) as string[];
      const w = nextSf[slot];
      if (w && candidates.includes(w)) sfClean[slot] = w;
    }
    // Recompute Final candidates from the cleaned SFs.
    const finalCandidates = [sfClean.sf1, sfClean.sf2].filter(Boolean) as string[];
    const finalClean =
      nextFinal && finalCandidates.includes(nextFinal) ? nextFinal : null;

    const out: PlayoffPick[] = [];
    for (const t of Object.values(nextQf)) if (t) out.push({ round: 1, teamId: t });
    for (const t of Object.values(sfClean)) if (t) out.push({ round: 2, teamId: t });
    if (finalClean) {
      out.push({ round: 3, teamId: finalClean });
      out.push({ round: 4, teamId: finalClean }); // Champion = Final winner
    }
    setPicks(out);
  }

  function onPickQf(matchId: string, teamId: string) {
    const cur = qfWinnerByMatchId[matchId];
    const next: Record<string, string | null> = { ...qfWinnerByMatchId };
    next[matchId] = cur === teamId ? null : teamId;
    rebuild(next, sfWinnerBySlot, finalWinnerId);
  }

  function onPickSf(slot: Slot, teamId: string) {
    const cur = sfWinnerBySlot[slot];
    const nextSf: Record<Slot, string | null> = { ...sfWinnerBySlot };
    nextSf[slot] = cur === teamId ? null : teamId;
    rebuild(qfWinnerByMatchId, nextSf, finalWinnerId);
  }

  function onPickFinal(teamId: string) {
    const next = finalWinnerId === teamId ? null : teamId;
    rebuild(qfWinnerByMatchId, sfWinnerBySlot, next);
  }

  // ---- Render -----------------------------------------------------------

  if (qfSorted.length === 0) {
    return (
      <section className="rounded-2xl border border-line bg-panel p-5">
        <h2 className="mb-1 text-lg font-semibold">Playoffs Bracket</h2>
        <p className="text-sm text-muted">
          Bracket teams haven't been confirmed yet. Come back once Stage 3
          finishes.
        </p>
      </section>
    );
  }

  // QF cards are evenly spaced; SF cards sit between each pair; Final sits
  // between the two SFs. The pt-* offsets line everything up visually.
  return (
    <section className="rounded-2xl border border-line bg-panel p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Playoffs Bracket</h2>
        <span className="text-xs text-muted">
          Click a team to advance them
        </span>
      </div>

      <div className="flex gap-6 overflow-x-auto pb-2">
        {/* Quarterfinals */}
        <Column title="Quarterfinals">
          <div className="flex flex-col gap-4">
            {qfSorted.map((m) => {
              const locked = m.status === "FINISHED";
              const userPick = qfWinnerByMatchId[m.id];
              return (
                <BracketMatchCard
                  key={m.id}
                  teamA={m.teamA!}
                  teamB={m.teamB!}
                  winnerId={userPick}
                  onPick={(teamId) => onPickQf(m.id, teamId)}
                  locked={locked}
                  pickCorrect={correctnessFor(1, userPick)}
                />
              );
            })}
          </div>
        </Column>

        {/* Semifinals */}
        <Column title="Semifinals">
          {/* Vertical spacing aligned to QF cards (offset so SF sits between QF pairs). */}
          <div className="flex flex-col gap-[88px] pt-[40px]">
            {sfPairings.map((p) => {
              const sfMatch = sfMatchBySlot[p.slot];
              const locked = sfMatch?.status === "FINISHED";
              const userPick = sfWinnerBySlot[p.slot];
              return (
                <BracketMatchCard
                  key={p.slot}
                  teamA={p.a}
                  teamB={p.b}
                  winnerId={userPick}
                  onPick={(teamId) => onPickSf(p.slot, teamId)}
                  placeholder="Pick QF winners first"
                  locked={locked}
                  pickCorrect={correctnessFor(2, userPick)}
                />
              );
            })}
          </div>
        </Column>

        {/* Grand Final + Champion */}
        <Column title="Grand Final">
          <div className="flex flex-col gap-4 pt-[120px]">
            <BracketMatchCard
              teamA={finalPair.a}
              teamB={finalPair.b}
              winnerId={finalWinnerId}
              onPick={onPickFinal}
              placeholder="Pick SF winners first"
              locked={finalMatch?.status === "FINISHED"}
              pickCorrect={correctnessFor(3, finalWinnerId)}
            />
            <ChampionCard
              team={finalWinnerTeam}
              correct={correctnessFor(4, finalWinnerId)}
            />
          </div>
        </Column>
      </div>
    </section>
  );
}

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-[220px] flex-1 flex-col">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
        {title}
      </div>
      {children}
    </div>
  );
}

function BracketMatchCard({
  teamA,
  teamB,
  winnerId,
  onPick,
  placeholder,
  locked = false,
  pickCorrect = null,
}: {
  teamA: ClientTeam | null;
  teamB: ClientTeam | null;
  winnerId: string | null;
  onPick: (teamId: string) => void;
  placeholder?: string;
  // True when the underlying match has FINISHED — disables click-to-pick
  // so the user can't retro-edit a settled result.
  locked?: boolean;
  // null = pick still in flight (no tint); true = correct (green tint);
  // false = busted (red tint). Applied only to the SELECTED row.
  pickCorrect?: boolean | null;
}) {
  const isEmpty = !teamA && !teamB;
  if (isEmpty) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-panel/40 px-3 py-6 text-center text-xs text-muted">
        {placeholder ?? "TBD"}
      </div>
    );
  }
  return (
    <div
      className={clsx(
        "overflow-hidden rounded-xl border bg-panel2",
        // Outer border colour mirrors the pick's outcome when settled — a
        // subtle cue you can see at a glance scanning down the bracket.
        pickCorrect === true && "border-win/60",
        pickCorrect === false && "border-loss/60",
        pickCorrect == null && "border-line",
      )}
    >
      <TeamRow
        team={teamA}
        selected={!!winnerId && winnerId === teamA?.id}
        onPick={onPick}
        locked={locked}
        pickCorrect={winnerId === teamA?.id ? pickCorrect : null}
      />
      <div className="border-t border-line" />
      <TeamRow
        team={teamB}
        selected={!!winnerId && winnerId === teamB?.id}
        onPick={onPick}
        locked={locked}
        pickCorrect={winnerId === teamB?.id ? pickCorrect : null}
      />
    </div>
  );
}

function TeamRow({
  team,
  selected,
  onPick,
  locked = false,
  pickCorrect = null,
}: {
  team: ClientTeam | null;
  selected: boolean;
  onPick: (teamId: string) => void;
  locked?: boolean;
  pickCorrect?: boolean | null;
}) {
  if (!team) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted">
        <div className="h-6 w-6 rounded-full border border-dashed border-line" />
        <span>— TBD —</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        if (!locked) onPick(team.id);
      }}
      disabled={locked}
      draggable={false}
      className={clsx(
        "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors",
        // Settled state — tint based on whether the user's pick landed.
        selected && pickCorrect === true && "bg-win/15 text-win ring-1 ring-inset ring-win/50",
        selected && pickCorrect === false && "bg-loss/15 text-loss ring-1 ring-inset ring-loss/50",
        // In-flight state — keep the accent highlight.
        selected && pickCorrect == null && "bg-accent/20 text-accent ring-1 ring-inset ring-accent",
        !selected && !locked && "hover:bg-line/40",
        !selected && locked && "opacity-60",
      )}
      aria-pressed={selected}
      aria-disabled={locked}
    >
      <TeamLogo team={team} size={28} />
      <span className="flex-1 truncate text-sm font-medium">{team.name}</span>
      {selected && pickCorrect === true && (
        <span className="font-mono text-xs text-win">✓</span>
      )}
      {selected && pickCorrect === false && (
        <span className="font-mono text-xs text-loss">✗</span>
      )}
      {selected && pickCorrect == null && (
        <span className="text-[10px] font-semibold uppercase tracking-wide text-accent">
          Advances
        </span>
      )}
    </button>
  );
}

function ChampionCard({
  team,
  correct = null,
}: {
  team: ClientTeam | null;
  correct?: boolean | null;
}) {
  if (!team) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-panel/40 px-3 py-6 text-center text-xs text-muted">
        Champion appears once you pick the Final winner
      </div>
    );
  }
  return (
    <div
      className={clsx(
        "rounded-xl border px-3 py-4 text-center",
        correct === true && "border-win/60 bg-win/10",
        correct === false && "border-loss/60 bg-loss/10",
        correct == null && "border-accent/60 bg-accent/10",
      )}
    >
      <div
        className={clsx(
          "text-[10px] font-semibold uppercase tracking-wide",
          correct === true && "text-win",
          correct === false && "text-loss",
          correct == null && "text-accent",
        )}
      >
        Champion
        {correct === true && " ✓"}
        {correct === false && " ✗"}
      </div>
      <div className="mt-2 flex flex-col items-center gap-2">
        <TeamLogo team={team} size={48} />
        <span className="text-sm font-semibold">{team.name}</span>
      </div>
    </div>
  );
}
