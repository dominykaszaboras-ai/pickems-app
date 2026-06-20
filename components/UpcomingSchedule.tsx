"use client";
// Compact schedule of the next ~24h of matches across all stages, grouped
// by day. Sits at the top of the bracket so users see what's playing soon
// without scrolling through every stage.

import type { ClientMatch, ClientTournament } from "@/lib/types";
import { dayKey, formatMatchTime, hhmm } from "@/lib/formatTime";
import { resolveWatchLinks } from "@/lib/streams";
import { TeamLogo } from "./TeamLogo";
import Link from "next/link";

const HORIZON_MS = 36 * 60 * 60 * 1000; // 36h ahead

export function UpcomingSchedule({ tournament }: { tournament: ClientTournament }) {
  const now = Date.now();

  // Flatten PENDING matches with a startTime within the horizon window.
  // We also skip rows whose BOTH teams are still unknown — those are
  // bracket placeholders (e.g. the Grand Final before any SF concludes)
  // and showing "TBD vs TBD" in the schedule is just noise. A row with
  // one known team + one TBD (e.g. Spirit advanced, SF opponent still
  // playing) is still useful, so we keep those.
  const matches: Array<ClientMatch & { stageName: string }> = [];
  for (const stage of tournament.stages) {
    for (const m of stage.matches) {
      if (m.status !== "PENDING") continue;
      if (!m.startTime) continue;
      if (!m.teamA && !m.teamB) continue; // both-TBD bracket placeholder
      const t = new Date(m.startTime).getTime();
      if (t < now - 5 * 60_000) continue; // skip matches more than 5 min late
      if (t > now + HORIZON_MS) continue;
      matches.push({ ...m, stageName: stage.name });
    }
  }
  matches.sort((a, b) => +new Date(a.startTime!) - +new Date(b.startTime!));

  if (matches.length === 0) return null;

  // Group by day for readability.
  const byDay = new Map<string, typeof matches>();
  for (const m of matches) {
    const key = dayKey(m.startTime);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(m);
  }

  return (
    <section className="rounded-2xl border border-line bg-panel p-4">
      <h2 className="mb-3 flex items-center justify-between text-lg font-semibold">
        <span>Upcoming matches</span>
        <span className="text-xs font-normal text-muted">next {Math.round(HORIZON_MS / 3600_000)}h</span>
      </h2>
      <div className="flex flex-col gap-3">
        {[...byDay.entries()].map(([day, ms]) => (
          <div key={day}>
            <div className="mb-1 text-[10px] font-semibold uppercase text-muted">{day}</div>
            <div className="flex flex-col divide-y divide-line">
              {ms.map((m) => (
                <div key={m.id} className="flex items-center gap-3 py-1.5 text-sm">
                  <span className="w-12 shrink-0 font-mono text-[11px] text-muted">
                    {m.startTime ? hhmm(new Date(m.startTime)) : ""}
                  </span>
                  <span className="flex w-32 items-center gap-1.5 truncate">
                    <TeamLogo team={m.teamA} size={16} />
                    <span className="truncate">{m.teamA?.name ?? "TBD"}</span>
                  </span>
                  <span className="text-[10px] text-muted">vs</span>
                  <span className="flex w-32 items-center gap-1.5 truncate">
                    <TeamLogo team={m.teamB} size={16} />
                    <span className="truncate">{m.teamB?.name ?? "TBD"}</span>
                  </span>
                  <span className="flex-1 text-right text-[10px] text-muted">
                    {m.stageName} · BO{m.bestOf || 1} · {formatMatchTime(m.startTime)}
                  </span>
                  <ScheduleWatchButtons match={m} tournament={tournament} />
                  {m.hltvId && (
                    <Link
                      href={`https://www.hltv.org/matches/${m.hltvId}/_`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded px-1 text-[10px] text-muted hover:bg-panel2 hover:text-text"
                    >
                      ↗
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// Schedule-row variant of the stream buttons. Same idea as the per-match
// pair in MatchCard but condensed to fit the schedule's tight row layout.
function ScheduleWatchButtons({
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
        <Link
          href={twitchUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="Watch on Twitch"
          className="rounded px-1 text-[10px] font-semibold text-muted hover:bg-purple-500/15 hover:text-purple-300"
        >
          TW
        </Link>
      )}
      {youtubeUrl && (
        <Link
          href={youtubeUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="Watch on YouTube"
          className="rounded px-1 text-[10px] font-semibold text-muted hover:bg-red-500/15 hover:text-red-400"
        >
          YT
        </Link>
      )}
    </span>
  );
}
