// One-off: rewrite Stage.name to match STAGE_NAMES from lib/sync.ts, and
// drop the stale HLTV event 9029 tournament so only the umbrella 8301 row
// remains active.
//
// Run with:
//   DATABASE_URL=... npx tsx scripts/backfill-stage-names.ts

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

const NAMES: Record<string, string> = {
  STAGE_1: "Stage 1 (Swiss)",
  STAGE_2: "Stage 2 (Swiss)",
  STAGE_3: "Stage 3 (Swiss)",
  PLAYOFFS: "Playoffs",
};

async function main() {
  let updated = 0;
  for (const [kind, name] of Object.entries(NAMES)) {
    const r = await p.stage.updateMany({ where: { kind }, data: { name } });
    updated += r.count;
  }
  console.log(`Backfilled ${updated} stage row(s).`);

  // Optional: clean up the stale 9029 tournament so /bracket doesn't pick
  // up the older snapshot if its lastSyncedAt ever leapfrogs 8301.
  const old = await p.tournament.findUnique({ where: { hltvEventId: 9029 } });
  if (old) {
    const matches = await p.match.deleteMany({
      where: { stage: { tournamentId: old.id } },
    });
    const stages = await p.stage.deleteMany({ where: { tournamentId: old.id } });
    const links = await p.tournamentTeam.deleteMany({ where: { tournamentId: old.id } });
    await p.tournament.delete({ where: { id: old.id } });
    console.log("Removed stale 9029 tournament:", {
      matches: matches.count,
      stages: stages.count,
      links: links.count,
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
