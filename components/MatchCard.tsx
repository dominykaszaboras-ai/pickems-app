"use client";
import clsx from "clsx";
import type { ClientMatch, ClientTournament } from "@/lib/types";
import { TeamLogo } from "./TeamLogo";
import { formatMatchTime } from "@/lib/formatTime";
import { resolveWatchLinks } from "@/lib/streams";
import { Countdown } from "./Countdown";

export function MatchCard({
  match,
  effectiveWinnerId,
  onPick,
  pickHints,
  tournament,
}: {
  match: ClientMatch;
  effectiveWinnerId: string | null;
  // When user clicks a team. Pass null to clear the override.
  onPick: (matchId: string, teamId: string | null) => void;
  // Optional UI hint (e.g. "your 3-0 pick").
  pickHints?: { [teamId: string]: string | undefined };
  // Provides stream-channel fallback when the match doesn't carry its own.
  // Optional so existing MatchCard callsites without tournament context
  // (e.g. tests, projections) still compile.
  tournament?: ClientTournament;
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
      <div className="mb-1 flex items-center justify-between gap-2 px-2 text-[10px] text-muted">
        <span className="flex items-center gap-1.5">
          <span>
            {match.bestOf ? `BO${match.bestOf}` : ""}
            {match.swissRound != null ? ` · R${match.swissRound}` : ""}
          </span>
          {match.status === "PENDING" && match.startTime && (
            <span className="text-text">
              · {formatMatchTime(match.startTime)}
              {soonish(match.startTime) && (
                <span className="ml-1 text-accent">
                  · <Countdown iso={match.startTime} />
                </span>
              )}
            </span>
          )}
        </span>
        <span className="flex items-center gap-2">
          {match.status === "LIVE" && (
            <span className="flex items-center gap-1 rounded bg-loss/15 px-1.5 py-0.5 text-loss">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-loss" />
              LIVE
            </span>
          )}
          {match.status === "PENDING" && isOverridden && <span className="text-accent">SIM</span>}
          {match.status === "FINISHED" && <span>Final</span>}
          {match.status !== "FINISHED" && tournament && (
            <StreamButtons match={match} tournament={tournament} />
          )}
          {match.hltvId && (
            <a
              href={`https://www.hltv.org/matches/${match.hltvId}/_`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="Open on HLTV"
              className="rounded px-1 text-muted hover:bg-panel2 hover:text-text"
            >
              ↗
            </a>
          )}
        </span>
      </div>
      {pickRow(a, match.scoreA)}
      {pickRow(b, match.scoreB)}
    </div>
  );
}

// True when a PENDING match starts within the next 6 hours — only then do
// we surface the live countdown next to the absolute time. Beyond that the
// "today HH:mm" / "tomorrow HH:mm" label conveys enough on its own.
function soonish(iso: string): boolean {
  const diffMs = new Date(iso).getTime() - Date.now();
  return diffMs > 0 && diffMs < 6 * 60 * 60 * 1000;
}

// Compact pair of Twitch / YouTube link buttons. Hidden when neither layer
// (match override or tournament default) resolved to a real URL.
function StreamButtons({
  match,
  tournament,
}: {
  match: ClientMatch;
  tournament: ClientTournament;
}) {
  const { twitchUrl, youtubeUrl } = resolveWatchLinks(match, tournament);
  if (!twitchUrl && !youtubeUrl) return null;
  return (
    <span className="flex items-center gap-0.5">
      {twitchUrl && (
        <a
          href={twitchUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title="Watch on Twitch"
          aria-label="Watch on Twitch"
          className="flex items-center justify-center rounded px-1 py-0.5 text-muted hover:bg-purple-500/15 hover:text-[#a970ff]"
        >
          <TwitchIcon />
        </a>
      )}
      {youtubeUrl && (
        <a
          href={youtubeUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title="Watch on YouTube"
          aria-label="Watch on YouTube"
          className="flex items-center justify-center rounded px-1 py-0.5 text-muted hover:bg-red-500/15 hover:text-[#ff0033]"
        >
          <YouTubeIcon />
        </a>
      )}
    </span>
  );
}

// Inline SVGs so we don't pull in an icon library. Both use currentColor so
// they inherit the hover tint set on the parent <a>.
function TwitchIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={12}
      height={12}
      fill="currentColor"
    >
      <path d="M4 2 2 6v14h5v3h3l3-3h4l6-6V2H4Zm17 11-4 4h-4l-3 3v-3H6V4h15v9ZM10 7v6h2V7h-2Zm6 0v6h2V7h-2Z" />
    </svg>
  );
}

function YouTubeIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="currentColor"
    >
      <path d="M23 6.2a3 3 0 0 0-2.1-2.1C19 3.6 12 3.6 12 3.6s-7 0-8.9.5A3 3 0 0 0 1 6.2C.6 8.1.6 12 .6 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5A3 3 0 0 0 23 17.8c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8ZM9.7 15.6V8.4l6.2 3.6-6.2 3.6Z" />
    </svg>
  );
}
