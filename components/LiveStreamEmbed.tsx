"use client";
// Embedded Twitch player that appears at the top of /bracket whenever any
// match is LIVE. Hidden the rest of the time — there's no point burning
// users' bandwidth on the main broadcast when nothing's playing.
//
// Twitch's player requires the embedding host to be whitelisted via the
// `parent` query param, which has to match window.location.hostname exactly.
// That makes it a client-side component by necessity.

import { useEffect, useState } from "react";
import type { ClientMatch, ClientTournament } from "@/lib/types";
import { resolveWatchLinks, twitchEmbedSrc } from "@/lib/streams";

export function LiveStreamEmbed({ tournament }: { tournament: ClientTournament }) {
  // Find a representative live match — preference goes to a match that
  // explicitly tags its own Twitch URL, then anything else live (we'll fall
  // back to the tournament default channel).
  const liveMatches: ClientMatch[] = [];
  for (const s of tournament.stages) {
    for (const m of s.matches) {
      if (m.status === "LIVE") liveMatches.push(m);
    }
  }

  const [parentHost, setParentHost] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    setParentHost(window.location.hostname);
  }, []);

  if (liveMatches.length === 0) return null;
  if (hidden) return null;

  // Pick the first match with its own Twitch override, else use any.
  const preferred = liveMatches.find((m) => m.twitchUrl) ?? liveMatches[0];
  const { twitchChannel } = resolveWatchLinks(preferred, tournament);

  if (!twitchChannel || !parentHost) return null;

  return (
    <section className="rounded-2xl border border-loss/40 bg-panel p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <span className="h-2 w-2 animate-pulse rounded-full bg-loss" />
          <span>Live now — watching {twitchChannel}</span>
        </h2>
        <div className="flex items-center gap-2">
          <a
            href={`https://www.twitch.tv/${twitchChannel}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-line bg-panel2 px-2 py-1 text-xs text-muted hover:text-text"
          >
            Open on Twitch ↗
          </a>
          <button
            onClick={() => setHidden(true)}
            className="rounded border border-line bg-panel2 px-2 py-1 text-xs text-muted hover:text-text"
            aria-label="Hide stream"
            title="Hide stream until next page load"
          >
            Hide
          </button>
        </div>
      </div>
      <div className="aspect-video w-full overflow-hidden rounded-lg border border-line bg-black">
        <iframe
          src={twitchEmbedSrc(twitchChannel, parentHost)}
          title={`Twitch stream: ${twitchChannel}`}
          allowFullScreen
          // Twitch requires these for embedded autoplay/fullscreen behaviour.
          allow="autoplay; fullscreen; picture-in-picture"
          className="h-full w-full"
        />
      </div>
    </section>
  );
}
