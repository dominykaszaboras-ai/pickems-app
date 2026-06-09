"use client";
// Stage 3 preview: when Stage 2 is concluded but Stage 3 has no synced
// matches yet, show the 8 teams that advanced from Stage 2 as the
// projected Stage 3 field. The user can mentally / via the picker assign
// hypothetical results.
//
// Once Stage 3's HLTV event id is wired into HLTV_STAGE_EVENTS and real
// matches sync in, this panel hides itself and the real SwissStage takes
// over.

import { useMemo } from "react";
import type { ClientStage, ClientTournament, StageKind } from "@/lib/types";
import { STAGE_LABEL } from "@/lib/types";
import { computeSwissStandings } from "@/lib/scoring";
import { TeamLogo } from "./TeamLogo";

interface Projection {
  advancing: Array<{ teamId: string; teamName: string; teamLogo: string | null; record: string }>;
  eliminated: Array<{ teamId: string; teamName: string; teamLogo: string | null; record: string }>;
}

export function StageProjection({
  tournament,
  forStage,
  sourceStage,
}: {
  tournament: ClientTournament;
  forStage: StageKind; // e.g. "STAGE_3"
  sourceStage: StageKind; // e.g. "STAGE_2" — the stage whose advancing teams feed this one
}) {
  const source = tournament.stages.find((s) => s.kind === sourceStage);
  const target = tournament.stages.find((s) => s.kind === forStage);

  // Hide entirely if the target stage already has real matches, or the source
  // stage isn't concluded.
  const targetHasMatches = (target?.matches.length ?? 0) > 0;
  const sourceConcluded = useMemo(() => {
    if (!source || source.matches.length === 0) return false;
    return source.matches.every((m) => m.status === "FINISHED");
  }, [source]);
  if (targetHasMatches || !sourceConcluded || !source) return null;

  const projection: Projection = useMemo(() => {
    const standings = computeSwissStandings(source, {});
    // Pull team metadata from the source stage's match rosters.
    const teamById = new Map<string, ClientStage["matches"][number]["teamA"]>();
    for (const m of source.matches) {
      if (m.teamA) teamById.set(m.teamA.id, m.teamA);
      if (m.teamB) teamById.set(m.teamB.id, m.teamB);
    }
    const advancing: Projection["advancing"] = [];
    const eliminated: Projection["eliminated"] = [];
    for (const s of standings.values()) {
      const team = teamById.get(s.teamId);
      if (!team) continue;
      const row = {
        teamId: s.teamId,
        teamName: team.name,
        teamLogo: team.logo,
        record: `${s.wins}-${s.losses}`,
      };
      if (s.status === "ADVANCED") advancing.push(row);
      else if (s.status === "ELIMINATED") eliminated.push(row);
    }
    // Sort advancing by record best-first (3-0, 3-1, 3-2).
    advancing.sort((a, b) => {
      const al = Number(a.record.split("-")[1]);
      const bl = Number(b.record.split("-")[1]);
      return al - bl || a.teamName.localeCompare(b.teamName);
    });
    eliminated.sort((a, b) => a.teamName.localeCompare(b.teamName));
    return { advancing, eliminated };
  }, [source]);

  if (projection.advancing.length === 0) return null;

  return (
    <section className="rounded-2xl border border-dashed border-accent/40 bg-panel/60 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          {STAGE_LABEL[forStage]} <span className="text-sm font-normal text-muted">— projected</span>
        </h2>
        <span className="rounded bg-panel2 px-2 py-0.5 text-[10px] uppercase text-muted">
          not synced yet
        </span>
      </div>
      <p className="mb-3 text-xs text-muted">
        Stage 3 matches haven't been published on HLTV. Until they are, here's
        the field we expect — the {projection.advancing.length} teams that
        advanced out of {STAGE_LABEL[sourceStage]}.
      </p>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {projection.advancing.map((row) => (
          <div
            key={row.teamId}
            className="flex items-center gap-2 rounded border border-line bg-panel2 p-2 text-sm"
          >
            <TeamLogo team={{ name: row.teamName, logo: row.teamLogo }} size={20} />
            <span className="flex-1 truncate">{row.teamName}</span>
            <span className="font-mono text-[11px] text-muted">{row.record}</span>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[11px] text-muted">
        Heads up: in CS2 Major format, Stage 3 typically reseeds from the Stage 2
        advancing field — exact matchups depend on Valve's seeding. Once HLTV
        publishes the bracket and you add its event id to{" "}
        <code>HLTV_STAGE_EVENTS</code>, this preview is replaced by the live
        bracket + simulator automatically.
      </p>
    </section>
  );
}
