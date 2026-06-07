"use client";
import { useMemo, useState } from "react";
import clsx from "clsx";
import {
  SWISS_STAGE_KINDS,
  STAGE_LABEL,
  type ClientPickem,
  type ClientPickemPick,
  type ClientTeam,
  type ClientTournament,
  type StageKind,
} from "@/lib/types";
import { TeamLogo } from "./TeamLogo";

type SwissPicks = {
  three_oh: string[];   // up to PERFECT_COUNT teams
  zero_three: string[]; // up to PERFECT_COUNT teams
  advance: string[];    // up to ADVANCE_COUNT teams (each goes 3-1 or 3-2)
};

// 2025/26 Valve format: 2 picks for 3-0, 2 picks for 0-3, 6 picks for 3-x advance.
const PERFECT_COUNT = 2;
const ADVANCE_COUNT = 6;

export function PickemsForm({
  tournament,
  initial,
}: {
  tournament: ClientTournament;
  initial: ClientPickem | null;
}) {
  // Per-stage team rosters are computed server-side from each stage's match
  // list (see lib/queries.ts). A stage is "unlocked" only once it has at
  // least one synced match — picks for future stages stay locked until then.
  const stagesByKind = new Map<StageKind, ClientTeam[]>();
  for (const s of tournament.stages) {
    stagesByKind.set(s.kind, s.teams);
  }
  const teamsFor = (k: StageKind): ClientTeam[] => stagesByKind.get(k) ?? [];
  const isUnlocked = (k: StageKind): boolean => (stagesByKind.get(k)?.length ?? 0) > 0;
  // Friendly "opens after X" copy for locked stages.
  const lockedReason: Record<StageKind, string> = {
    STAGE_1: "Stage 1 hasn't been synced yet.",
    STAGE_2: "Unlocks once Stage 2 starts.",
    STAGE_3: "Unlocks once Stage 3 starts.",
    PLAYOFFS: "Unlocks once Playoffs start.",
  };

  function pickedOf(stage: StageKind): SwissPicks {
    const inStage = (initial?.picks ?? []).filter((p) => p.stageKind === stage);
    return {
      three_oh: inStage.filter((p) => p.kind === "SWISS_3_0").map((p) => p.teamId),
      zero_three: inStage.filter((p) => p.kind === "SWISS_0_3").map((p) => p.teamId),
      advance: inStage.filter((p) => p.kind === "SWISS_ADVANCE").map((p) => p.teamId),
    };
  }

  // One SwissPicks state slot per Swiss stage.
  const [swiss, setSwiss] = useState<Record<StageKind, SwissPicks>>(() => ({
    STAGE_1: pickedOf("STAGE_1"),
    STAGE_2: pickedOf("STAGE_2"),
    STAGE_3: pickedOf("STAGE_3"),
    PLAYOFFS: { three_oh: [], zero_three: [], advance: [] }, // unused
  }));
  function setSwissFor(kind: StageKind) {
    return (p: SwissPicks) => setSwiss((prev) => ({ ...prev, [kind]: p }));
  }

  const [playoffs, setPlayoffs] = useState<Record<number, string | null>>(() => {
    const init: Record<number, string | null> = { 1: null, 2: null, 3: null, 4: null };
    for (const p of initial?.picks ?? []) {
      if (p.kind === "PLAYOFF_WINNER" && p.round != null) init[p.round] = p.teamId;
    }
    return init;
  });

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const allPicks: ClientPickemPick[] = useMemo(() => {
    const out: ClientPickemPick[] = [];
    for (const stageKind of SWISS_STAGE_KINDS) {
      const sp = swiss[stageKind];
      for (const t of sp.three_oh) out.push({ kind: "SWISS_3_0", stageKind, teamId: t, round: null });
      for (const t of sp.zero_three) out.push({ kind: "SWISS_0_3", stageKind, teamId: t, round: null });
      for (const t of sp.advance) out.push({ kind: "SWISS_ADVANCE", stageKind, teamId: t, round: null });
    }
    for (const [round, teamId] of Object.entries(playoffs)) {
      if (teamId) out.push({ kind: "PLAYOFF_WINNER", stageKind: "PLAYOFFS", teamId, round: Number(round) });
    }
    return out;
  }, [swiss, playoffs]);

  async function save() {
    setSaving(true);
    setMsg(null);
    const res = await fetch("/api/pickems", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tournamentId: tournament.id, picks: allPicks }),
    });
    setSaving(false);
    if (res.ok) setMsg("Saved!");
    else {
      const d = await res.json().catch(() => ({}));
      setMsg(d.error ?? "Failed to save");
    }
  }

  return (
    <div className="flex flex-col gap-10">
      {SWISS_STAGE_KINDS.map((kind) =>
        isUnlocked(kind) ? (
          <SwissPicker
            key={kind}
            title={STAGE_LABEL[kind] + " (Swiss)"}
            teams={teamsFor(kind)}
            picks={swiss[kind]}
            setPicks={setSwissFor(kind)}
          />
        ) : (
          <LockedStage
            key={kind}
            title={STAGE_LABEL[kind] + " (Swiss)"}
            reason={lockedReason[kind]}
          />
        ),
      )}
      {isUnlocked("PLAYOFFS") ? (
        <PlayoffsPicker teams={teamsFor("PLAYOFFS")} picks={playoffs} setPicks={setPlayoffs} />
      ) : (
        <LockedStage title="Playoffs" reason={lockedReason.PLAYOFFS} />
      )}

      <div className="sticky bottom-4 flex items-center justify-between rounded-2xl border border-line bg-panel/90 p-4 backdrop-blur">
        <div className="text-sm text-muted">{allPicks.length} picks selected</div>
        <div className="flex items-center gap-3">
          {msg && <span className="text-sm text-muted">{msg}</span>}
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-accent px-4 py-2 font-semibold text-ink disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save pickems"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SwissPicker({
  title,
  teams,
  picks,
  setPicks,
}: {
  title: string;
  teams: ClientTeam[];
  picks: SwissPicks;
  setPicks: (p: SwissPicks) => void;
}) {
  // Generic toggle that respects the per-slot cap.
  function toggleIn(list: string[], id: string, cap: number): string[] {
    if (list.includes(id)) return list.filter((x) => x !== id);
    if (list.length >= cap) return list;
    return [...list, id];
  }

  return (
    <section className="rounded-2xl border border-line bg-panel p-5">
      <h2 className="mb-1 text-lg font-semibold">{title}</h2>
      <p className="mb-4 text-sm text-muted">
        Pick <span className="text-accent">{PERFECT_COUNT}</span> teams to go 3-0,{" "}
        <span className="text-loss">{PERFECT_COUNT}</span> teams to go 0-3, and{" "}
        <span className="text-win">{ADVANCE_COUNT}</span> more to advance 3-1 or 3-2.
      </p>

      <div className="mb-3 flex flex-wrap gap-3 text-xs text-muted">
        <span>3-0: <span className="text-text">{picks.three_oh.length}/{PERFECT_COUNT}</span></span>
        <span>0-3: <span className="text-text">{picks.zero_three.length}/{PERFECT_COUNT}</span></span>
        <span>Advance: <span className="text-text">{picks.advance.length}/{ADVANCE_COUNT}</span></span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {teams.map((t) => {
          const is30 = picks.three_oh.includes(t.id);
          const is03 = picks.zero_three.includes(t.id);
          const isAdv = picks.advance.includes(t.id);
          // 3-0 / 0-3 / ADV are mutually exclusive per team.
          const used = is30 || is03 || isAdv;
          const slot30Full = picks.three_oh.length >= PERFECT_COUNT && !is30;
          const slot03Full = picks.zero_three.length >= PERFECT_COUNT && !is03;
          const slotAdvFull = picks.advance.length >= ADVANCE_COUNT && !isAdv;
          return (
            <div
              key={t.id}
              className={clsx(
                "flex items-center gap-2 rounded-xl border bg-panel2 p-2",
                is30 && "border-accent",
                is03 && "border-loss",
                isAdv && "border-win",
                !used && "border-line",
              )}
            >
              <TeamLogo team={t} size={24} />
              <span className="flex-1 truncate text-sm">{t.name}</span>
              <div className="flex gap-1 text-[10px]">
                <button
                  disabled={slot30Full || is03 || isAdv}
                  onClick={() => setPicks({ ...picks, three_oh: toggleIn(picks.three_oh, t.id, PERFECT_COUNT) })}
                  className={clsx(
                    "rounded px-1.5 py-0.5",
                    is30 ? "bg-accent text-ink" : "bg-panel text-muted",
                    (slot30Full || is03 || isAdv) && "opacity-30",
                  )}
                >
                  3-0
                </button>
                <button
                  disabled={slot03Full || is30 || isAdv}
                  onClick={() => setPicks({ ...picks, zero_three: toggleIn(picks.zero_three, t.id, PERFECT_COUNT) })}
                  className={clsx(
                    "rounded px-1.5 py-0.5",
                    is03 ? "bg-loss text-ink" : "bg-panel text-muted",
                    (slot03Full || is30 || isAdv) && "opacity-30",
                  )}
                >
                  0-3
                </button>
                <button
                  disabled={slotAdvFull || is30 || is03}
                  onClick={() => setPicks({ ...picks, advance: toggleIn(picks.advance, t.id, ADVANCE_COUNT) })}
                  className={clsx(
                    "rounded px-1.5 py-0.5",
                    isAdv ? "bg-win text-ink" : "bg-panel text-muted",
                    (slotAdvFull || is30 || is03) && "opacity-30",
                  )}
                >
                  ADV
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function LockedStage({ title, reason }: { title: string; reason: string }) {
  return (
    <section className="rounded-2xl border border-dashed border-line bg-panel/40 p-5">
      <div className="flex items-center gap-2 text-muted">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="rounded bg-panel2 px-2 py-0.5 text-[10px] uppercase">Locked</span>
      </div>
      <p className="mt-2 text-sm text-muted">{reason}</p>
    </section>
  );
}

function PlayoffsPicker({
  teams,
  picks,
  setPicks,
}: {
  teams: ClientTeam[];
  picks: Record<number, string | null>;
  setPicks: (p: Record<number, string | null>) => void;
}) {
  return (
    <section className="rounded-2xl border border-line bg-panel p-5">
      <h2 className="mb-1 text-lg font-semibold">Champions Stage (Playoffs)</h2>
      <p className="mb-4 text-sm text-muted">
        QF winner = <span className="text-accent">1 pt</span>, SF ={" "}
        <span className="text-accent">2 pts</span>, Final ={" "}
        <span className="text-accent">4 pts</span>. Pick the champion last.
      </p>

      {[
        { round: 1, label: "Quarter-finals" },
        { round: 2, label: "Semi-finals" },
        { round: 3, label: "Grand Final" },
        { round: 4, label: "Champion" },
      ].map(({ round, label }) => (
        <div key={round} className="mb-4">
          <div className="mb-2 text-sm font-medium text-muted">{label}</div>
          <select
            className="w-full rounded-lg border border-line bg-panel2 px-3 py-2"
            value={picks[round] ?? ""}
            onChange={(e) => setPicks({ ...picks, [round]: e.target.value || null })}
          >
            <option value="">— pick a team —</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      ))}
    </section>
  );
}
