// Print which teams are referenced by matches in each stage, for the active
// tournament. Helps debug "teams in wrong stages" reports.
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  const tournament = await p.tournament.findFirst({
    orderBy: { lastSyncedAt: "desc" },
    include: {
      stages: {
        include: {
          matches: {
            include: { teamA: true, teamB: true },
          },
        },
      },
    },
  });
  if (!tournament) {
    console.log("No tournament.");
    return;
  }
  console.log(`Tournament: ${tournament.name} (hltvEventId=${tournament.hltvEventId})`);

  for (const stage of [...tournament.stages].sort((a, b) => a.kind.localeCompare(b.kind))) {
    const set = new Set<string>();
    const counts: Record<string, number> = {};
    for (const m of stage.matches) {
      for (const t of [m.teamA, m.teamB]) {
        if (!t) continue;
        set.add(t.name);
        counts[t.name] = (counts[t.name] ?? 0) + 1;
      }
    }
    const teams = [...set].sort();
    console.log(`\n=== ${stage.kind} (${stage.matches.length} matches, ${teams.length} unique teams) ===`);
    for (const name of teams) {
      console.log(`  ${counts[name].toString().padStart(2)} matches  ${name}`);
    }
  }
}

main().finally(() => p.$disconnect());
