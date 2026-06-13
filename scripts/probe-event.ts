// Read-only probe to discover HLTV event IDs.
//
// Modes:
//   tsx scripts/probe-event.ts ids 9030 9031        -> print event metadata for each ID
//   tsx scripts/probe-event.ts find "Stage 3"        -> scan upcoming + recent results for
//                                                       matches whose event.name matches the
//                                                       substring, then print unique event IDs.
//
// Does NOT touch the database.

import HLTV from "hltv";
import { fetchEventSnapshot } from "../lib/hltv";

async function probeIds(ids: number[]) {
  for (const id of ids) {
    console.log(`\n=== HLTV event ${id} ===`);
    try {
      const snap = await fetchEventSnapshot(id);
      console.log("  name:        ", snap.name);
      console.log("  startDate:   ", snap.startDate?.toISOString() ?? "(none)");
      console.log("  endDate:     ", snap.endDate?.toISOString() ?? "(none)");
      console.log("  teams:       ", snap.teams.length);
      console.log("  upcoming:    ", snap.upcomingMatches.length);
      console.log("  results:     ", snap.resultMatches.length);
      if (snap.teams.length) {
        console.log("  team sample: ", snap.teams.slice(0, 5).map((t) => t.name).join(", "));
      }
    } catch (err) {
      console.error("  ERROR:", err instanceof Error ? err.message : err);
    }
  }
}

async function findEvent(needle: string) {
  const lower = needle.toLowerCase();
  const seen = new Map<number, string>();

  console.log(`Searching upcoming HLTV.getMatches() for event name containing "${needle}"...`);
  try {
    const upcoming = (await (HLTV.getMatches() as Promise<any[]>)) ?? [];
    for (const m of upcoming) {
      const evName = String(m?.event?.name ?? "");
      const evId = Number(m?.event?.id ?? 0);
      if (evId && evName.toLowerCase().includes(lower)) {
        seen.set(evId, evName);
      }
    }
    console.log(`  scanned ${upcoming.length} upcoming matches`);
  } catch (err) {
    console.error("  upcoming ERROR:", err instanceof Error ? err.message : err);
  }

  console.log(`Searching recent HLTV.getResults() for event name containing "${needle}"...`);
  try {
    const results = (await (HLTV.getResults({ pages: 3 } as any) as Promise<any[]>)) ?? [];
    for (const m of results) {
      const evName = String(m?.event?.name ?? "");
      const evId = Number(m?.event?.id ?? 0);
      if (evId && evName.toLowerCase().includes(lower)) {
        seen.set(evId, evName);
      }
    }
    console.log(`  scanned ${results.length} result matches`);
  } catch (err) {
    console.error("  results ERROR:", err instanceof Error ? err.message : err);
  }

  console.log(`\nMatched events (${seen.size}):`);
  for (const [id, name] of seen) {
    console.log(`  ${id}  ${name}`);
  }
}

// Scan a numeric range of event IDs, printing those whose name contains the needle.
// Concurrency is capped — getEvent is HLTV's most-blocked endpoint so be polite.
async function scanRange(from: number, to: number, needle: string) {
  const lower = needle.toLowerCase();
  const ids: number[] = [];
  for (let i = from; i <= to; i++) ids.push(i);

  const CONCURRENCY = 6;
  let cursor = 0;
  const matched: Array<{ id: number; name: string }> = [];

  async function worker() {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      try {
        const ev: any = await (HLTV as any).getEvent({ id });
        const name = String(ev?.name ?? "");
        if (name && name.toLowerCase().includes(lower)) {
          console.log(`  HIT  ${id}  ${name}`);
          matched.push({ id, name });
        }
      } catch {
        // ignore — blocked or missing
      }
    }
  }

  console.log(`Scanning event IDs ${from}..${to} for "${needle}" (concurrency ${CONCURRENCY})...`);
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log(`\nMatches (${matched.length}):`);
  for (const m of matched) console.log(`  ${m.id}  ${m.name}`);
}

// Probe what fetchStageMatches(<eventId>, <stageKind>) would return — i.e.
// what the sync would actually import for that stage event. No DB writes.
async function probeStage(eventId: number, stageKind: string) {
  const { fetchStageMatches } = await import("../lib/hltv");
  const ms = await fetchStageMatches(eventId, stageKind as any);
  console.log(`fetchStageMatches(${eventId}, ${stageKind}) returned ${ms.length} matches`);
  for (const m of ms) {
    const date = m.startTime ? m.startTime.toISOString() : "?";
    console.log(
      `  ${m.hltvId}  ${date}  ${m.status.padEnd(8)}  swR=${m.swissRound ?? "-"}  brR=${m.bracketRound ?? "-"}  ${m.teamAName ?? "?"} ${m.scoreA}-${m.scoreB} ${m.teamBName ?? "?"}${m.winnerName ? `  W:${m.winnerName}` : ""}`,
    );
  }
}

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === "stage") {
    const id = Number(rest[0]);
    const kind = rest[1];
    if (!Number.isFinite(id) || !kind) {
      console.error('Usage: tsx scripts/probe-event.ts stage <eventId> <STAGE_1|STAGE_2|STAGE_3|PLAYOFFS>');
      process.exit(1);
    }
    await probeStage(id, kind);
    return;
  }
  if (mode === "scan") {
    const from = Number(rest[0]);
    const to = Number(rest[1]);
    const needle = rest.slice(2).join(" ").trim();
    if (!Number.isFinite(from) || !Number.isFinite(to) || !needle) {
      console.error('Usage: tsx scripts/probe-event.ts scan <from> <to> "<needle>"');
      process.exit(1);
    }
    await scanRange(from, to, needle);
    return;
  }
  if (mode === "ids") {
    const ids = rest.map((s) => Number(s)).filter((n) => Number.isFinite(n) && n > 0);
    if (!ids.length) {
      console.error("Usage: tsx scripts/probe-event.ts ids <eventId> [eventId ...]");
      process.exit(1);
    }
    await probeIds(ids);
  } else if (mode === "find") {
    const needle = rest.join(" ").trim();
    if (!needle) {
      console.error('Usage: tsx scripts/probe-event.ts find "Stage 3"');
      process.exit(1);
    }
    await findEvent(needle);
  } else {
    console.error("Usage:");
    console.error("  tsx scripts/probe-event.ts ids <eventId> [eventId ...]");
    console.error('  tsx scripts/probe-event.ts find "<needle>"');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
