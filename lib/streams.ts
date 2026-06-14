// Stream-URL resolution helpers.
//
// We store two layers of stream data:
//   1. Per-match override (Match.twitchUrl / Match.youtubeUrl) — populated by
//      the daily Liquipedia sync whenever Liquipedia actually tags a match
//      with its own broadcast (e.g. a regional broadcast for one grand
//      final). Usually null.
//   2. Tournament default (Tournament.twitchChannel / youtubeChannel) — the
//      main broadcast that covers every match. Populated daily from the
//      umbrella event's external-links section on Liquipedia.
//
// These helpers normalize whichever layer is set into the URLs the UI uses.

import type { ClientMatch, ClientTournament } from "./types";

export interface WatchLinks {
  twitchUrl: string | null;
  youtubeUrl: string | null;
  twitchChannel: string | null; // raw handle, used for the iframe embed
}

export function resolveWatchLinks(
  match: ClientMatch | null | undefined,
  tournament: ClientTournament,
): WatchLinks {
  // Per-match overrides win, falling back to tournament defaults.
  const twitchUrl =
    match?.twitchUrl ??
    (tournament.twitchChannel ? `https://www.twitch.tv/${tournament.twitchChannel}` : null);
  const youtubeUrl =
    match?.youtubeUrl ??
    (tournament.youtubeChannel
      ? `https://www.youtube.com/@${tournament.youtubeChannel}/live`
      : null);

  // For the Twitch embed we need just the channel handle. Pull it back out
  // of a per-match override if present, else use the tournament default.
  const twitchChannel =
    extractTwitchChannel(match?.twitchUrl) ?? tournament.twitchChannel ?? null;

  return { twitchUrl, youtubeUrl, twitchChannel };
}

function extractTwitchChannel(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/twitch\.tv\/([A-Za-z0-9_-]{2,40})/i);
  return m ? m[1] : null;
}

// Browser-only — Twitch's iframe player requires the parent host to be
// explicitly whitelisted in the URL. We compute it from window.location at
// render time so the same code works on prod, preview deploys, and localhost.
export function twitchEmbedSrc(channel: string, parentHost: string): string {
  const p = new URLSearchParams({
    channel,
    parent: parentHost,
    muted: "true", // browsers block autoplay otherwise
  });
  return `https://player.twitch.tv/?${p.toString()}`;
}
