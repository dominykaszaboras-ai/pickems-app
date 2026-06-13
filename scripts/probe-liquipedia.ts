// Dry-run the Liquipedia schedule fetcher and print everything it extracts.
// Reads no env vars, writes no DB rows.
//
// Usage:
//   npx tsx scripts/probe-liquipedia.ts          - parse + print matches
//   npx tsx scripts/probe-liquipedia.ts raw      - dump raw HTML snippet
//   npx tsx scripts/probe-liquipedia.ts snippet  - dump 1 match-info block

import { COLOGNE_2026_LIQUIPEDIA, fetchSchedule } from "../lib/liquipedia";

async function fetchRaw(slug: string): Promise<string | null> {
  const url = `https://liquipedia.net/counterstrike/api.php?action=parse&page=${encodeURIComponent(slug)}&format=json&prop=text&disableeditsection=1&redirects=1`;
  const res = await fetch(url, {
    headers: { "user-agent": "pickems-app/1.0 (+probe)" },
  });
  const j = (await res.json().catch(() => null)) as any;
  return j?.parse?.text?.["*"] ?? null;
}

async function main() {
  const mode = process.argv[2] ?? "parse";

  if (mode === "raw") {
    const slug = COLOGNE_2026_LIQUIPEDIA.STAGE_3!;
    const html = await fetchRaw(slug);
    if (!html) return console.error("no html");
    // Find the first timer-object and print 3kb around it.
    const idx = html.indexOf("data-timestamp");
    if (idx < 0) return console.error("no timer-object");
    console.log(html.slice(Math.max(0, idx - 500), idx + 3000));
    return;
  }

  if (mode === "snippet") {
    const slug = COLOGNE_2026_LIQUIPEDIA.STAGE_3!;
    const html = await fetchRaw(slug);
    if (!html) return console.error("no html");
    // Find one .match-info block.
    const open = html.indexOf('class="match-info');
    if (open < 0) return console.error("no match-info block");
    const close = html.indexOf("</div></div></div>", open);
    console.log(html.slice(open, close + 18));
    return;
  }

  const matches = await fetchSchedule(COLOGNE_2026_LIQUIPEDIA);
  console.log(`Liquipedia returned ${matches.length} matches`);
  const sorted = [...matches].sort(
    (a, b) => a.startTime.getTime() - b.startTime.getTime(),
  );
  for (const m of sorted) {
    console.log(
      `  ${m.startTime.toISOString()}  ${m.stageKind.padEnd(8)}  BO${m.bestOf}  ${m.teamAName ?? "?"} vs ${m.teamBName ?? "?"}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
