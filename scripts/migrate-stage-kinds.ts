// One-shot migration: rename existing Stage.kind values from the old
// CHALLENGERS / LEGENDS / CHAMPIONS names to STAGE_1 / STAGE_2 / PLAYOFFS,
// and the same for PickemPick.stageKind. Adds a STAGE_3 stage for every
// tournament that doesn't already have one.
//
// Usage:
//   DATABASE_URL="…" npx tsx scripts/migrate-stage-kinds.ts

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const RENAME: Record<string, string> = {
  CHALLENGERS: "STAGE_1",
  LEGENDS: "STAGE_2",
  CHAMPIONS: "PLAYOFFS",
};

async function main() {
  for (const [from, to] of Object.entries(RENAME)) {
    const stages = await prisma.stage.updateMany({
      where: { kind: from },
      data: { kind: to },
    });
    const picks = await prisma.pickemPick.updateMany({
      where: { stageKind: from },
      data: { stageKind: to },
    });
    console.log(`renamed ${from} -> ${to}: ${stages.count} stages, ${picks.count} pickem picks`);
  }

  // Ensure every tournament has a STAGE_3 stage (the new "third Swiss" stage
  // that didn't exist in previous Majors).
  const tournaments = await prisma.tournament.findMany({ select: { id: true } });
  let added = 0;
  for (const t of tournaments) {
    const existing = await prisma.stage.findUnique({
      where: { tournamentId_kind: { tournamentId: t.id, kind: "STAGE_3" } },
    });
    if (!existing) {
      await prisma.stage.create({
        data: { tournamentId: t.id, kind: "STAGE_3", name: "Stage 3 (Swiss)" },
      });
      added++;
    }
  }
  console.log(`added STAGE_3 to ${added} tournament(s)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
