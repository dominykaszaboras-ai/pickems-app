"use client";
// Expandable detail strip rendered under a MatchCard. Lazy-fetches map
// results + recent head-to-head from /api/matches/[hltvId]/details on
// first expand. Subsequent collapses keep the data in state so reopening
// is instant.
//
// We only render the trigger when match.hltvId is present (it's the API
// key). Pre-HLTV-adopted ghost rows skip the section entirely.

import { useState } from "react";
import clsx from "clsx";

interface MapResult {
  name: string;
  scoreA: number;
  scoreB: number;
  pick: "A" | "B" | "DECIDER" | null;
}

interface H2HEntry {
  hltvId: number | null;
  startTime: string | null;
  scoreForA: number;
  scoreForB: number;
  winnerWasA: boolean;
  winnerWasB: boolean;
  tournament: string;
  stage: string;
  // "local" for entries from our DB (always have stage), "hltv" for the
  // broader 1-year archive pulled from HLTV.getResults (no stage).
  source?: "local" | "liquipedia" | "hltv";
}

interface MatchDetailsPayload {
  maps: MapResult[];
  h2h: H2HEntry[];
  teamA: { id: string; name: string } | null;
  teamB: { id: string; name: string } | null;
}

export function MatchDetails({ hltvId }: { hltvId: number | null }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<MatchDetailsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!hltvId) return null;

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !data && !loading) {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`/api/matches/${hltvId}/details`, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json: MatchDetailsPayload = await r.json();
        setData(json);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <div className="border-t border-line/60">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        className="flex w-full items-center justify-between px-2 py-1 text-[10px] text-muted hover:bg-panel2/60 hover:text-text"
        aria-expanded={open}
      >
        <span>{open ? "Hide details" : "Maps & head-to-head"}</span>
        <span className={clsx("transition-transform", open && "rotate-180")}>▾</span>
      </button>
      {open && (
        <div className="space-y-2 px-2 pb-2 pt-1 text-[11px]">
          {loading && <div className="text-muted">Loading…</div>}
          {error && <div className="text-loss">Couldn't load details ({error}).</div>}
          {data && (
            <>
              <MapList data={data} />
              <H2HList data={data} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MapList({ data }: { data: MatchDetailsPayload }) {
  if (data.maps.length === 0) {
    return (
      <div className="text-muted">No map data available from HLTV.</div>
    );
  }
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase text-muted">Maps</div>
      <ul className="flex flex-col gap-0.5">
        {data.maps.map((m, i) => {
          const aWon = m.scoreA > m.scoreB;
          const bWon = m.scoreB > m.scoreA;
          return (
            <li
              key={`${m.name}-${i}`}
              className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded px-1 py-0.5"
            >
              <span className="truncate font-medium">
                {m.name}
                {m.pick === "DECIDER" && (
                  <span className="ml-1 text-[9px] uppercase text-muted">decider</span>
                )}
              </span>
              <span className={clsx("font-mono tabular-nums", aWon && "text-win", bWon && "text-muted line-through")}>
                {m.scoreA}
              </span>
              <span className={clsx("font-mono tabular-nums", bWon && "text-win", aWon && "text-muted line-through")}>
                {m.scoreB}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function H2HList({ data }: { data: MatchDetailsPayload }) {
  if (data.h2h.length === 0) {
    return (
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase text-muted">Head-to-head</div>
        <div className="text-muted">No prior meetings recorded.</div>
      </div>
    );
  }
  // Aggregate wins for the recap line.
  let aWins = 0;
  let bWins = 0;
  for (const h of data.h2h) {
    if (h.winnerWasA) aWins++;
    else if (h.winnerWasB) bWins++;
  }
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[10px] uppercase text-muted">
        <span className="font-semibold">Last {data.h2h.length} meeting{data.h2h.length === 1 ? "" : "s"}</span>
        <span className="font-mono">
          <span className={aWins > bWins ? "text-win" : ""}>{aWins}</span>
          <span className="mx-0.5 text-muted">·</span>
          <span className={bWins > aWins ? "text-win" : ""}>{bWins}</span>
        </span>
      </div>
      <ul className="flex flex-col gap-0.5">
        {data.h2h.map((h, i) => (
          <li
            key={`${h.hltvId ?? "g"}-${i}`}
            className="flex items-center justify-between gap-2 rounded px-1 py-0.5"
          >
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-muted">
              <span className="truncate">
                {h.tournament}
                {h.stage ? ` · ${h.stage}` : ""}
              </span>
              {h.startTime && (
                <span className="shrink-0 font-mono text-[9px] opacity-60">
                  {new Date(h.startTime).toLocaleDateString(undefined, { month: "short", year: "2-digit" })}
                </span>
              )}
            </span>
            <span className="font-mono tabular-nums">
              <span className={clsx(h.winnerWasA && "text-win", h.winnerWasB && "text-loss")}>
                {h.scoreForA}
              </span>
              <span className="mx-0.5 text-muted">–</span>
              <span className={clsx(h.winnerWasB && "text-win", h.winnerWasA && "text-loss")}>
                {h.scoreForB}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
