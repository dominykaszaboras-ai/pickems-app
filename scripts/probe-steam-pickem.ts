// Probe Valve's ICSGOTournaments_730 for the current Major's event ID.
//
// Valve assigns each Major an internal numeric event ID (Antwerp 2022 = 15,
// Rio 2022 = 16, …) but never publishes them. We have to guess. This script
// walks a range and calls GetTournamentLayout/v1 — non-empty / 200 responses
// almost certainly belong to a real Major.
//
// Usage:
//   STEAM_API_KEY=... npx tsx scripts/probe-steam-pickem.ts          (range 1..40)
//   STEAM_API_KEY=... npx tsx scripts/probe-steam-pickem.ts 20 60    (range 20..60)
//   STEAM_API_KEY=... npx tsx scripts/probe-steam-pickem.ts 27       (single id, full JSON)
//
// Reads STEAM_API_KEY from the process env. Doesn't touch the DB.

const KEY = process.env.STEAM_API_KEY;
if (!KEY) {
  console.error("STEAM_API_KEY not set");
  process.exit(1);
}

const BASE = "https://api.steampowered.com/ICSGOTournaments_730";

function scrub(text: string): string {
  return KEY ? text.split(KEY).join("***") : text;
}

interface LayoutSummary {
  eventId: number;
  status: number;
  bytes: number;
  // Best-effort name extraction. The layout JSON may not contain a name —
  // we still report the call as "non-empty" since the structure tells us
  // it's a real event.
  name?: string;
  sectionCount?: number;
  groupCount?: number;
  pickCount?: number;
  teamHints?: string[];
}

async function probe(eventId: number): Promise<LayoutSummary> {
  const u = new URL(`${BASE}/GetTournamentLayout/v1/`);
  u.searchParams.set("key", KEY!);
  u.searchParams.set("event", String(eventId));
  const r = await fetch(u.toString(), { headers: { "user-agent": "pickems-app/probe" } });
  const text = await r.text();
  const summary: LayoutSummary = {
    eventId,
    status: r.status,
    bytes: text.length,
  };
  if (!r.ok) return summary;

  try {
    const j = JSON.parse(text);
    const root = j?.result ?? j;
    summary.name =
      root?.name ?? root?.event_name ?? root?.tournament_name ?? undefined;
    const sections: any[] = root?.sections ?? root?.tournament_sections ?? [];
    if (Array.isArray(sections)) {
      summary.sectionCount = sections.length;
      let groups = 0;
      let picks = 0;
      const teams = new Set<string>();
      for (const s of sections) {
        const grs: any[] = s?.groups ?? s?.tournament_groups ?? [];
        groups += grs.length;
        for (const g of grs) {
          const ps: any[] = g?.picks ?? g?.tournament_picks ?? [];
          picks += ps.length;
          for (const p of ps) {
            const n = p?.name ?? p?.team_name;
            if (typeof n === "string" && n) teams.add(n);
          }
        }
      }
      summary.groupCount = groups;
      summary.pickCount = picks;
      summary.teamHints = [...teams].slice(0, 10);
    }
  } catch {
    // Non-JSON 200 — keep raw bytes count only.
  }
  return summary;
}

// `node ... start end` -> range. `node ... id` -> single dump.
const argStart = process.argv[2];
const argEnd = process.argv[3];

async function main() {
  if (argStart && !argEnd) {
    // Single id: dump the full JSON (key scrubbed if it ever appears).
    const id = Number(argStart);
    const u = new URL(`${BASE}/GetTournamentLayout/v1/`);
    u.searchParams.set("key", KEY!);
    u.searchParams.set("event", String(id));
    const r = await fetch(u.toString(), { headers: { "user-agent": "pickems-app/probe" } });
    const text = await r.text();
    console.log(`event=${id} status=${r.status}`);
    console.log(scrub(text));
    return;
  }

  const start = Number(argStart ?? "1");
  const end = Number(argEnd ?? "40");
  console.log(
    `Probing event IDs ${start}..${end} via GetTournamentLayout/v1\n`,
  );

  const hits: LayoutSummary[] = [];
  for (let id = start; id <= end; id++) {
    let s: LayoutSummary;
    try {
      s = await probe(id);
    } catch (e) {
      console.log(`  ${id.toString().padStart(3)}  ERROR ${(e as Error).message}`);
      continue;
    }
    const hit =
      s.status === 200 &&
      ((s.sectionCount ?? 0) > 0 || (s.pickCount ?? 0) > 0 || s.bytes > 50);
    const tag = hit ? "✓ HIT " : "    .  ";
    let line = `${tag}${id.toString().padStart(3)}  status=${s.status}  bytes=${s.bytes
      .toString()
      .padStart(6)}`;
    if (s.name) line += `  name="${s.name}"`;
    if (s.sectionCount != null) {
      line += `  sec=${s.sectionCount}  grp=${s.groupCount}  picks=${s.pickCount}`;
    }
    console.log(line);
    if (hit) hits.push(s);
    // Be polite to Valve's rate limit — they're generous but no need to spike.
    await new Promise((r) => setTimeout(r, 150));
  }

  console.log(`\n=== ${hits.length} hit(s) ===`);
  for (const h of hits) {
    console.log(
      `  ${h.eventId}: name=${h.name ?? "?"}  teams=${
        h.teamHints?.length ? h.teamHints.join(", ") : "?"
      }`,
    );
  }
  console.log(
    "\nNext: pick the one whose team list matches Cologne 2026, then\n" +
      "  railway variables --set STEAM_PICKEM_EVENT_ID=<id>",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
