"use client";
// majors.im-style pool layout for a Swiss stage. Teams are grouped by their
// current (wins, losses) record into columns: 3-0, 3-1, 3-2 (advanced),
// 2-3, 1-3, 0-3 (eliminated), plus the active mid-stage pools (2-x, 1-x,
// 0-x with fewer than 3 games played).
//
// Each team shows: logo, name, W-L record. Teams the user picked get an
// accent ring + small badge (3-0 / 0-3 / ADV).

import { useMemo } from "react";
import clsx from "clsx";
import type { ClientPickem, ClientStage } from "@/lib/types";
import { computeSwissStandings, type WinnerOverrides } from "@/lib/scoring";
import { TeamLogo } from "./TeamLogo";

// Columns ordered as majors.im does: best→worst overall.
// We compute pools dynamically from actual standings so it gracefully handles
// edge cases (e.g. fewer than 5 rounds played).
const POOL_ORDER: Array<[number, number, string, "ADVANCED" | "ACTIVE" | "ELIMINATED"]> = [
  [3, 0, "3-0", "ADVANCED"],
  [3, 1, "3-1", "ADVANCED"],
  [3, 2, "3-2", "ADVANCED"],
  [2, 0, "2-0", "ACTIVE"],
  [2, 1, "2-1", "ACTIVE"],
  [2, 2, "2-2", "ACTIVE"],
  [1, 0, "1-0", "ACTIVE"],
  [1, 1, "1-1", "ACTIVE"],
  [1, 2, "1-2", "ACTIVE"],
  [0, 0, "0-0", "ACTIVE"],
  [0, 1, "0-1", "ACTIVE"],
  [0, 2, "0-2", "ACTIVE"],
  [2, 3, "2-3", "ELIMINATED"],
  [1, 3, "1-3", "ELIMINATED"],
  [0, 3, "0-3", "ELIMINATED"],
];

export function SwissPoolView({
  stage,
  overrides,
  pickem,
}: {
  stage: ClientStage;
  overrides: WinnerOverrides;
  pickem: ClientPickem | null;
}) {
  const standings = useMemo(() => computeSwissStandings(stage, overrides), [stage, overrides]);

  // Build a lookup from teamId → ClientTeam for logo + name rendering.
  const teamById = useMemo(() => {
    const m = new Map<string, (typeof stage.matches)[number]["teamA"]>();
    for (const match of stage.matches) {
      if (match.teamA) m.set(match.teamA.id, match.teamA);
      if (match.teamB) m.set(match.teamB.id, match.teamB);
    }
    return m;
  }, [stage.matches]);

  // What did the user pick in this stage?
  const pickKindByTeamId = useMemo(() => {
    const out = new Map<string, "3-0" | "0-3" | "ADV">();
    if (!pickem) return out;
    for (const p of pickem.picks) {
      if (p.stageKind !== stage.kind) continue;
      if (p.kind === "SWISS_3_0") out.set(p.teamId, "3-0");
      else if (p.kind === "SWISS_0_3") out.set(p.teamId, "0-3");
      else if (p.kind === "SWISS_ADVANCE") out.set(p.teamId, "ADV");
    }
    return out;
  }, [pickem, stage.kind]);

  // Bucket teams into pools by their record.
  const pools = useMemo(() => {
    const out = new Map<string, Array<{ teamId: string; wins: number; losses: number }>>();
    for (const s of standings.values()) {
      const key = `${s.wins}-${s.losses}`;
      if (!out.has(key)) out.set(key, []);
      out.get(key)!.push({ teamId: s.teamId, wins: s.wins, losses: s.losses });
    }
    return out;
  }, [standings]);

  // Filter to non-empty pools, in canonical order.
  const columns = POOL_ORDER.filter(([w, l]) => pools.has(`${w}-${l}`));

  // Group columns by status header (Advanced / Active / Eliminated).
  const groups: Array<{
    title: string;
    color: string;
    cols: Array<{ key: string; label: string }>;
  }> = [
    {
      title: "Advanced",
      color: "text-win",
      cols: columns.filter(([, , , g]) => g === "ADVANCED").map(([w, l, label]) => ({ key: `${w}-${l}`, label })),
    },
    {
      title: "In progress",
      color: "text-accent",
      cols: columns.filter(([, , , g]) => g === "ACTIVE").map(([w, l, label]) => ({ key: `${w}-${l}`, label })),
    },
    {
      title: "Eliminated",
      color: "text-loss",
      cols: columns.filter(([, , , g]) => g === "ELIMINATED").map(([w, l, label]) => ({ key: `${w}-${l}`, label })),
    },
  ].filter((g) => g.cols.length > 0);

  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <div key={g.title}>
          <div className={"mb-2 text-xs font-semibold uppercase " + g.color}>{g.title}</div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {g.cols.map((col) => {
              const items = pools.get(col.key) ?? [];
              return (
                <div
                  key={col.key}
                  className="flex min-w-[140px] flex-1 flex-col gap-1 rounded-lg border border-line bg-panel2 p-2"
                >
                  <div className="mb-1 text-center text-xs font-mono font-semibold text-muted">
                    {col.label}
                  </div>
                  {items.map(({ teamId }) => {
                    const team = teamById.get(teamId);
                    if (!team) return null;
                    const picked = pickKindByTeamId.get(teamId);
                    return (
                      <div
                        key={teamId}
                        className={clsx(
                          "flex items-center gap-2 rounded border bg-panel p-1.5 text-xs",
                          picked ? "border-accent" : "border-line",
                        )}
                      >
                        <TeamLogo team={team} size={16} />
                        <span className="flex-1 truncate">{team.name}</span>
                        {picked && (
                          <span className="rounded bg-accent/20 px-1 text-[9px] font-bold uppercase text-accent">
                            {picked}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
