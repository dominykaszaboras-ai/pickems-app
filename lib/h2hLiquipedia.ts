// Head-to-head data via Liquipedia's per-team /Matches subpage.
//
// Why: HLTV blocks Railway datacenter IPs via Cloudflare, so calling
// HLTV.getResults from our Next.js runtime usually fails. Liquipedia is
// accessible from anywhere and maintains a structured match history per
// team. Latency is fine for an on-demand panel that only fires when the
// user expands a match card.
//
// Strategy:
//   1. Resolve a Liquipedia slug for teamA. Try common patterns:
//      "Team_<name>", "<name>", "<name>_Esports", "<name>_Gaming". The
//      MediaWiki `parse` API + redirects=1 handles canonicalisation when
//      we hit a near-miss.
//   2. Fetch `<slug>/Matches` HTML.
//   3. Walk the match-history table rows looking for entries whose
//      opponent column links to teamB (also via slug variants).
//   4. Extract date, score, tournament name, win/loss tag.
//
// Cache key: sorted pair of normalised names. TTL 1h.

import { normalizeTeamName } from "./liquipedia";

export interface H2HFromSource {
  hltvId: number | null;
  startTime: string | null;
  scoreForA: number;
  scoreForB: number;
  winnerWasA: boolean;
  winnerWasB: boolean;
  tournament: string;
  source: "liquipedia";
}

interface CacheEntry {
  at: number;
  entries: H2HFromSource[];
}
const cache = new Map<string, CacheEntry>();
const TTL = 60 * 60 * 1000;

const API_BASE = "https://liquipedia.net/counterstrike/api.php";
const USER_AGENT =
  "pickems-app/1.0 (https://pickems-app-production.up.railway.app; +h2h)";

async function fetchHtml(slug: string): Promise<string | null> {
  const url = new URL(API_BASE);
  url.searchParams.set("action", "parse");
  url.searchParams.set("page", slug);
  url.searchParams.set("format", "json");
  url.searchParams.set("prop", "text");
  url.searchParams.set("disableeditsection", "1");
  url.searchParams.set("redirects", "1");
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, "accept-encoding": "gzip" },
  });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as any;
  if (json?.error) return null;
  return json?.parse?.text?.["*"] ?? null;
}

// Try a series of slug variants. Returns HTML of the first one that
// successfully returns a /Matches page.
async function fetchTeamMatchesHtml(teamName: string): Promise<string | null> {
  // Strip leading "Team " in the input so we don't end up with "Team_Team_X".
  const bare = teamName.replace(/^team\s+/i, "").trim();
  const candidates = [
    `Team_${slugify(bare)}/Matches`,
    `${slugify(bare)}/Matches`,
    `${slugify(bare)}_Esports/Matches`,
    `${slugify(bare)}_Gaming/Matches`,
  ];
  for (const slug of candidates) {
    const html = await fetchHtml(slug);
    if (html && html.includes("data-timestamp")) return html;
  }
  return null;
}

function slugify(s: string): string {
  // Liquipedia uses underscores between words; preserve letters/digits.
  return s.replace(/\s+/g, "_");
}

/**
 * Parse a single match-history table row (a <tr>...</tr> chunk) and
 * extract H2H fields. Returns null if the row doesn't shape like a
 * completed match or doesn't reference the opponent.
 */
function parseRow(rowHtml: string, opponentNormName: string): H2HFromSource | null {
  // Date: <span ... data-timestamp="<unix-seconds>">
  const tsMatch = rowHtml.match(/data-timestamp=["'](\d{9,11})["']/);
  if (!tsMatch) return null;
  const epoch = Number(tsMatch[1]);
  if (!Number.isFinite(epoch)) return null;

  // Score: two adjacent <span>NUM</span> separated by a colon entity.
  // The winner side is bolded with style="font-weight:bold".
  // Examples seen:
  //   <span>0</span>&#160;&#58;&#160;<span style="font-weight:bold">3</span>
  //   <span style="font-weight:bold">2</span>&#160;&#58;&#160;<span>1</span>
  const scoreMatch = rowHtml.match(
    /<span(?:\s+style="font-weight:bold")?\s*>(\d+)<\/span>[^<]*?(?:&#160;|&nbsp;|\s)*[:&#58;]+(?:&#160;|&nbsp;|\s)*<span(?:\s+style="font-weight:bold")?\s*>(\d+)<\/span>/,
  );
  if (!scoreMatch) return null;
  const scoreLeft = Number(scoreMatch[1]);
  const scoreRight = Number(scoreMatch[2]);
  // result-win / result-loss / result-draw class on a generic-label div in
  // the win/loss column tells us which side our team (teamA) was on.
  const resultMatch = rowHtml.match(
    /data-label-type=["']result-(win|loss|draw)["']/,
  );
  const teamAResult = resultMatch?.[1] ?? null;
  // The "score for teamA" is the side whose result matches the win/loss
  // tag. Convention on Liquipedia /Matches pages is: own team's score is
  // shown on the LEFT cell (before the colon) — verified empirically on
  // multiple team pages. Result tag tells us if teamA won.
  const scoreForA = scoreLeft;
  const scoreForB = scoreRight;
  const winnerWasA = teamAResult === "win";
  const winnerWasB = teamAResult === "loss";

  // Match any /counterstrike/<path> anchor — supports both single-segment
  // team slugs ("Team_Vitality") and multi-segment tournament paths
  // ("Intel_Extreme_Masters/2026/Cologne#Playoffs"). The capture stops
  // before any # fragment or ? query so the path is clean.
  const ANCHOR_RE = /<a[^>]+href=["']\/counterstrike\/([^"'#?]+)(?:[#?][^"']*)?["'][^>]*title=["']([^"']+)["']/g;
  const KNOWN_NON_TOURNAMENT_PREFIXES =
    /^(Team_|Special:|Template:|File:|Counter-Strike_2|S-Tier|A-Tier|B-Tier|C-Tier|D-Tier|Show_Matches|Major_Championships)/i;

  // Pass 1: find the opponent link.
  let foundOpponent = false;
  let opponentTitle = "";
  let r: RegExpExecArray | null;
  while ((r = ANCHOR_RE.exec(rowHtml)) !== null) {
    const slug = r[1];
    const title = r[2];
    // Skip clearly non-team anchors.
    if (/^(Special:|Template:|File:|Counter-Strike_2|S-Tier|A-Tier|B-Tier|C-Tier|D-Tier)/i.test(slug)) continue;
    if (/Tournaments?$/i.test(slug)) continue;
    const norm = normalizeTeamName(title);
    if (norm === opponentNormName || normalizeTeamName(slug.replace(/_/g, " ")) === opponentNormName) {
      foundOpponent = true;
      opponentTitle = title;
      break;
    }
  }
  if (!foundOpponent) return null;

  // Pass 2: find the tournament link. Multi-segment paths (containing a
  // slash) are a strong tournament signal — almost no team slug uses
  // them. We prefer those; fall back to any non-team anchor.
  let tournament = "";
  ANCHOR_RE.lastIndex = 0;
  while ((r = ANCHOR_RE.exec(rowHtml)) !== null) {
    const slug = r[1];
    const title = r[2];
    if (KNOWN_NON_TOURNAMENT_PREFIXES.test(slug)) continue;
    if (title === opponentTitle) continue;
    // Skip team-looking slugs (single segment, no slash, no year).
    if (!slug.includes("/") && !/\b(20\d{2}|Championship|Tournament|Major|Masters|League|Cup|Open|Invitational|Pro|Series|Showdown)/i.test(title)) continue;
    tournament = title;
    break;
  }
  // Last-resort fallback: any non-team anchor not matching the opponent.
  if (!tournament) {
    ANCHOR_RE.lastIndex = 0;
    while ((r = ANCHOR_RE.exec(rowHtml)) !== null) {
      const slug = r[1];
      const title = r[2];
      if (KNOWN_NON_TOURNAMENT_PREFIXES.test(slug)) continue;
      if (title === opponentTitle) continue;
      if (normalizeTeamName(title) === opponentNormName) continue;
      tournament = title;
      break;
    }
  }

  return {
    hltvId: null,
    startTime: new Date(epoch * 1000).toISOString(),
    scoreForA,
    scoreForB,
    winnerWasA,
    winnerWasB,
    tournament: tournament || "(unknown event)",
    source: "liquipedia",
  };
}

/**
 * Fetch H2H entries between teamA and teamB from Liquipedia. Returns
 * the most recent 10 meetings (sorted newest first). Empty array on any
 * failure — caller can fall back to other sources.
 */
export async function fetchLiquipediaH2H(
  teamAName: string,
  teamBName: string,
): Promise<H2HFromSource[]> {
  const cacheKey = [normalizeTeamName(teamAName), normalizeTeamName(teamBName)]
    .sort()
    .join("|");
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < TTL) return cached.entries;

  const html = await fetchTeamMatchesHtml(teamAName);
  if (!html) {
    cache.set(cacheKey, { at: Date.now(), entries: [] });
    return [];
  }

  // Split into match rows. Liquipedia's /Matches table rows follow the
  // pattern `<tr ...>...</tr>` and the table starts after the "match
  // history" header. We split on </tr> closers and treat each chunk as
  // a potential row.
  const opponentNorm = normalizeTeamName(teamBName);
  const out: H2HFromSource[] = [];
  const rows = html.split(/<\/tr>/);
  for (const row of rows) {
    if (!row.includes("data-timestamp")) continue;
    const parsed = parseRow(row, opponentNorm);
    if (parsed) out.push(parsed);
    if (out.length >= 30) break; // hard cap; we'll slice to 10 below
  }

  // Sort newest first, cap at 10.
  const sorted = out
    .sort(
      (a, b) =>
        (Date.parse(b.startTime ?? "") || 0) -
        (Date.parse(a.startTime ?? "") || 0),
    )
    .slice(0, 10);

  cache.set(cacheKey, { at: Date.now(), entries: sorted });
  return sorted;
}
