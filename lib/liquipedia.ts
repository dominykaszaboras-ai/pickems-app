// Liquipedia is our fallback source for upcoming match schedules.
//
// Why: HLTV.getMatches() routinely returns empty for our Major event from
// scripted clients (Cloudflare-managed challenge pages parsed as empty JSON),
// so the UpcomingSchedule component had nothing to render. Liquipedia is the
// community wiki — it has reliable structured match cards on the per-stage
// pages (e.g. /counterstrike/Intel_Extreme_Masters/2026/Cologne/Stage_3) and
// exposes a stable MediaWiki "parse" API that returns rendered HTML.
//
// Be polite:
//  - One request per page per call, never more than a few pages per minute.
//  - Honour Liquipedia's User-Agent policy by identifying ourselves with a
//    contact URL.
//  - Daily cron is plenty — see .github/workflows/sync-schedule.yml.

import type { StageKind } from "./types";

export interface LiquipediaMatch {
  startTime: Date;
  teamAName: string | null;
  teamBName: string | null;
  bestOf: number;
  stageKind: StageKind;
}

// Each entry maps a Major stage to its Liquipedia page slug under
// /counterstrike/. Update as new Cologne stages are published.
export type LiquipediaStageMap = Partial<Record<StageKind, string>>;

export const COLOGNE_2026_LIQUIPEDIA: LiquipediaStageMap = {
  STAGE_1: "Intel_Extreme_Masters/2026/Cologne/Stage_1",
  STAGE_2: "Intel_Extreme_Masters/2026/Cologne/Stage_2",
  STAGE_3: "Intel_Extreme_Masters/2026/Cologne/Stage_3",
  PLAYOFFS: "Intel_Extreme_Masters/2026/Cologne/Playoffs",
};

const API_BASE = "https://liquipedia.net/counterstrike/api.php";
const USER_AGENT =
  "pickems-app/1.0 (https://pickems-app-production.up.railway.app; +schedule sync)";

interface ParseApiResponse {
  parse?: {
    title?: string;
    text?: { "*": string };
  };
  error?: { code?: string; info?: string };
}

async function fetchPageHtml(pageSlug: string): Promise<string | null> {
  const url = new URL(API_BASE);
  url.searchParams.set("action", "parse");
  url.searchParams.set("page", pageSlug);
  url.searchParams.set("format", "json");
  url.searchParams.set("prop", "text");
  url.searchParams.set("disableeditsection", "1");
  url.searchParams.set("redirects", "1");

  const res = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      "accept-encoding": "gzip",
      // Liquipedia returns 304s well — we don't cache so just ask for fresh.
      "cache-control": "no-cache",
    },
  });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as ParseApiResponse | null;
  return json?.parse?.text?.["*"] ?? null;
}

// Each upcoming match on Liquipedia's stage page renders as:
//
//   <div class="match-info match-info--vertical">
//     <div class="match-info-top-row">
//       <span class="timer-object" data-timestamp="<epoch-seconds>">…</span>
//       … stream buttons …
//     </div>
//     <span class="match-info-stage">June 13</span>
//     <div class="match-info-header match-info-header-vertical">
//       <div class="match-info-opponent-row">
//         <a href="/counterstrike/B8" title="B8">…</a>      (× icon + name span)
//         <span class="match-info-opponent-score">0</span>
//       </div>
//       <div class="match-info-opponent-row">… FUT Esports …</div>
//     </div>
//   </div>
//
// We split the HTML at `match-info match-info--vertical` boundaries and pull
// the timer + the first two team anchors out of each segment. A full DOM
// parser would be cleaner but adds JSDOM-sized weight for a script that runs
// once a day.
export function parseLiquipediaMatches(html: string, stageKind: StageKind): LiquipediaMatch[] {
  const matches: LiquipediaMatch[] = [];
  const blocks = splitMatchInfoBlocks(html);

  for (const block of blocks) {
    const tsMatch = block.match(/data-timestamp=["'](\d{9,11})["']/);
    if (!tsMatch) continue;
    const epoch = Number(tsMatch[1]);
    if (!Number.isFinite(epoch) || epoch < 1_700_000_000 || epoch > 2_000_000_000) continue;

    const teamNames = collectTeamNames(block);
    if (teamNames.length < 2) continue;

    matches.push({
      startTime: new Date(epoch * 1000),
      teamAName: cleanTeamName(teamNames[0]),
      teamBName: cleanTeamName(teamNames[1]),
      bestOf: inferBestOf(block),
      stageKind,
    });
  }

  // De-dup identical (time, A, B) tuples — Liquipedia sometimes renders both
  // a carousel block and an upcoming-matches block for the same match.
  const seen = new Set<string>();
  return matches.filter((mm) => {
    const key = `${mm.startTime.getTime()}|${(mm.teamAName ?? "").toLowerCase()}|${(mm.teamBName ?? "").toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Slice the HTML into substrings each spanning one `match-info` block.
function splitMatchInfoBlocks(html: string): string[] {
  const blocks: string[] = [];
  const re = /class=["']match-info match-info(?:--vertical|--horizontal)?["']/g;
  const starts: number[] = [];
  let r: RegExpExecArray | null;
  while ((r = re.exec(html)) !== null) starts.push(r.index);
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : Math.min(html.length, start + 8000);
    blocks.push(html.slice(start, end));
  }
  return blocks;
}

// Pull team names from the two `match-info-opponent-row` children. We prefer
// the `<a href="/counterstrike/...">` anchors over a regex on `title=` because
// the title attribute is also set on stream / icon links that we want to skip.
function collectTeamNames(block: string): string[] {
  const names: string[] = [];

  // Find opponent rows.
  const rowRe = /class=["']match-info-opponent-row["'][^>]*>([\s\S]*?)(?=class=["']match-info-opponent-row["']|<\/div><\/div>$|$)/g;
  let r: RegExpExecArray | null;
  const rows: string[] = [];
  while ((r = rowRe.exec(block)) !== null) rows.push(r[1]);

  for (const row of rows) {
    const name = teamNameFromRow(row);
    if (name) names.push(name);
  }

  // Fallback: if we didn't find structured opponent rows, scan any
  // /counterstrike/<TeamSlug> anchor whose title isn't a known non-team page.
  if (names.length < 2) {
    const linkRe = /<a[^>]+href=["']\/counterstrike\/([^"'\/#?]+)["'][^>]+title=["']([^"']+)["']/g;
    while ((r = linkRe.exec(block)) !== null) {
      const slug = r[1];
      const title = r[2];
      if (isNonTeamSlug(slug, title)) continue;
      // Avoid pushing the same team twice from icon + name anchors.
      if (!names.includes(title)) names.push(title);
      if (names.length >= 2) break;
    }
  }

  return names;
}

function teamNameFromRow(row: string): string | null {
  // Try the most precise selector first: `<span class="name">...<a title="X">`.
  let m = row.match(/class=["']name["'][^>]*>\s*(?:<[^>]+>)*\s*<a[^>]+title=["']([^"']{1,80})["']/);
  if (m) return m[1];
  // Then any anchor with /counterstrike/<slug> title, skipping junk.
  const linkRe = /<a[^>]+href=["']\/counterstrike\/([^"'\/#?]+)["'][^>]+title=["']([^"']+)["']/g;
  let r: RegExpExecArray | null;
  while ((r = linkRe.exec(row)) !== null) {
    if (isNonTeamSlug(r[1], r[2])) continue;
    return r[2];
  }
  return null;
}

// Liquipedia drops Special:/template/help anchors into match blocks; reject
// these so they never get pushed as a team name.
function isNonTeamSlug(slug: string, title: string): boolean {
  if (/^Special:/i.test(slug)) return true;
  if (/^Template:/i.test(slug)) return true;
  if (/^File:/i.test(slug)) return true;
  if (/^Category:/i.test(slug)) return true;
  if (/Stream\/(twitch|youtube)/i.test(slug)) return true;
  if (/(Counter-Strike|esports?)$/i.test(slug)) return true;
  if (/(stream|twitch|youtube|edit|map|hltv|disambiguation)/i.test(title)) return true;
  return false;
}

function cleanTeamName(name: string | null | undefined): string | null {
  if (!name) return null;
  return name
    .replace(/\s*\(.*?\)\s*$/g, "") // strip trailing "(Counter-Strike)" disambig
    .replace(/\s+/g, " ")
    .trim() || null;
}

function inferBestOf(window: string): number {
  // Liquipedia labels series formats like "Bo3", "BO5", "Best of 3".
  if (/best\s*of\s*5|\bbo\s*5\b/i.test(window)) return 5;
  if (/best\s*of\s*3|\bbo\s*3\b/i.test(window)) return 3;
  if (/best\s*of\s*1|\bbo\s*1\b/i.test(window)) return 1;
  return 3; // Cologne Stage 2/3 + Playoffs are Bo3 by default.
}

export async function fetchSchedule(stages: LiquipediaStageMap): Promise<LiquipediaMatch[]> {
  const all: LiquipediaMatch[] = [];
  for (const [kind, slug] of Object.entries(stages) as Array<[StageKind, string]>) {
    if (!slug) continue;
    try {
      const html = await fetchPageHtml(slug);
      if (!html) continue;
      all.push(...parseLiquipediaMatches(html, kind));
    } catch (e) {
      console.warn(`[liquipedia] ${kind} fetch failed:`, (e as Error).message);
    }
    // Politeness gap between pages — Liquipedia asks for ≤30 reqs/min.
    await new Promise((r) => setTimeout(r, 1500));
  }
  return all;
}

// HLTV and Liquipedia don't always agree on team labels. HLTV tends toward
// the short brand ("FUT", "Falcons"), Liquipedia tends toward the legal
// org name ("FUT Esports", "Team Falcons"). normalizeTeamName collapses both
// into a comparable key so we can match a Liquipedia match to its HLTV-sourced
// Team row.
export function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/\bteam\b/g, "")
    .replace(/\besports?\b/g, "")
    .replace(/\bgaming\b/g, "")
    .replace(/\bclub\b/g, "")
    .replace(/\bnatus vincere\b/g, "navi")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}
