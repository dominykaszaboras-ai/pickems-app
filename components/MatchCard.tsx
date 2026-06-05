"use client";
import clsx from "clsx";
import type { ClientMatch } from "@/lib/types";
import { TeamLogo } from "./TeamLogo";

export function MatchCard({
  match,
  effectiveWinnerId,
  onPick,
  pickHints,
}: {
  match: ClientMatch;
  effectiveWinnerId: string | null;
  // When user clicks a team. Pass null to clear the override.
  onPick: (matchId: string, teamId: string | null) => void;
  // Optional UI hint (e.g. "your 3-0 pick").
  pickHints?: { [teamId: string]: string | undefined };
}) {
  const a = match.teamA;
  const b = match.teamB;
  const isOverridden = match.status !== "FINISHED" && effectiveWinnerId !== null;

  function pickRow(team: typeof a, score: number) {
    const isWinner = effectiveWinnerId !== null && team?.id === effectiveWinnerId;
    const isLoser = effectiveWinnerId !== null && team && team.id !== effectiveWinnerId;
    return (
      <button
        key={team?.id ?? Math.random()}
        disabled={!team || match.status === "FINISHED"}
        onClick={() => team && onPick(match.id, isWinner ? null : team.id)}
        className={clsx(
          "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left",
          isWinner && "bg-win/15 text-text",
          isLoser && "text-muted line-through opacity-60",
          !team && "opacity-40",
          team && match.status !== "FINISHED" && "hover:bg-panel2",
        )}
      >
        <TeamLogo team={team} size={20} />
        <span className="flex-1 truncate text-sm">{team?.name ?? "TBD"}</span>
        {pickHints && team && pickHints[team.id] && (
          <span className="rounded bg-accent/20 px-1.5 text-[10px] font-semibold uppercase text-accent">
            {pickHints[team.id]}
          </span>
        )}
        <span className="w-5 text-right font-mono text-sm">{score}</span>
      </button>
    );
  }

  return (
    <div
      className={clsx(
        "rounded-lg border bg-panel p-1",
        match.status === "LIVE" && "border-loss",
        match.status === "FINISHED" && "border-line",
        match.status === "PENDING" && isOverridden && "border-accent",
        match.status === "PENDING" && !isOverridden && "border-line",
      )}
    >
      <div className="mb-1 flex items-center justify-between px-2 text-[10px] text-muted">
        <span>
          {match.bestOf ? `BO${match.bestOf}` : ""}{" "}
          {match.swissRound != null ? `· R${match.swissRound}` : ""}
        </span>
        <span>
          {match.status === "LIVE" && <span className="text-loss">● LIVE</span>}
          {match.status === "PENDING" && isOverridden && <span className="text-accent">SIM</span>}
          {match.status === "FINISHED" && "Final"}
        </span>
      </div>
      {pickRow(a, match.scoreA)}
      {pickRow(b, match.scoreB)}
    </div>
  );
}
