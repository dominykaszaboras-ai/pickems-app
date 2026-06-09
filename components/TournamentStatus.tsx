"use client";
// Compact status row that explains the tournament state at a glance.
// Renders match counts per stage (finished / live / pending) and flags
// stages that have no synced data yet, with a hint on how to enable them.
//
// Lives above the bracket and the upcoming-schedule panel — so when no
// matches are live or upcoming, users still see *why* (e.g. "Stage 3 not
// synced yet — add its HLTV event id to HLTV_STAGE_EVENTS").

import { STAGE_LABEL, SWISS_STAGE_KINDS, type ClientTournament, type StageKind } from "@/lib/types";

const ALL: StageKind[] = [...SWISS_STAGE_KINDS, "PLAYOFFS"];

export function TournamentStatus({ tournament }: { tournament: ClientTournament }) {
  const stages = new Map(tournament.stages.map((s) => [s.kind, s]));

  return (
    <section className="rounded-2xl border border-line bg-panel p-4">
      <h2 className="mb-2 text-base font-semibold">Tournament status</h2>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {ALL.map((kind) => {
          const stage = stages.get(kind);
          const total = stage?.matches.length ?? 0;
          const finished = stage?.matches.filter((m) => m.status === "FINISHED").length ?? 0;
          const live = stage?.matches.filter((m) => m.status === "LIVE").length ?? 0;
          const pending = stage?.matches.filter((m) => m.status === "PENDING").length ?? 0;

          let statusLabel: string;
          let statusClass = "text-muted";
          if (total === 0) {
            statusLabel = "not synced";
            statusClass = "text-muted";
          } else if (live > 0) {
            statusLabel = `${live} live`;
            statusClass = "text-loss";
          } else if (pending > 0) {
            statusLabel = `${pending} upcoming`;
            statusClass = "text-accent";
          } else if (finished === total) {
            statusLabel = "concluded";
            statusClass = "text-win";
          } else {
            statusLabel = "in progress";
            statusClass = "text-accent";
          }

          return (
            <div key={kind} className="rounded-lg border border-line bg-panel2 p-3">
              <div className="text-xs font-semibold uppercase text-muted">{STAGE_LABEL[kind]}</div>
              <div className={"mt-1 text-sm font-semibold " + statusClass}>{statusLabel}</div>
              {total > 0 && (
                <div className="mt-1 font-mono text-[11px] text-muted">
                  {finished}f · {live}L · {pending}p
                </div>
              )}
            </div>
          );
        })}
      </div>
      {tournament.stages.every((s) => s.matches.length === 0 || s.matches.every((m) => m.status === "FINISHED")) && (
        <p className="mt-3 text-xs text-muted">
          No live or upcoming matches right now. When HLTV publishes the next
          stage's schedule, it'll show up here and on the bracket automatically.
          {tournament.stages.find((s) => s.kind === "STAGE_3")?.matches.length === 0 && (
            <> Stage 3 isn't wired up yet — add its HLTV event id to <code>HLTV_STAGE_EVENTS</code> when known.</>
          )}
        </p>
      )}
    </section>
  );
}
