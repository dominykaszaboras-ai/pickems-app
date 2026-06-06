// Seed a fake CS2 Major for offline development — useful when you can't / don't
// want to scrape HLTV. Wipes existing tournament with the same hltvEventId.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const FAKE_EVENT_ID = 99999;

const TEAMS = [
  "Vitality", "Spirit", "FaZe", "G2", "MOUZ", "NAVI", "Heroic", "Liquid",
  "Cloud9", "Astralis", "Falcons", "Eternal Fire", "Furia", "paiN", "Imperial", "9z",
];

async function main() {
  console.log("Seeding fake major (event_id = 99999) ...");

  // Wipe any prior matches/stages/teams for this tournament.
  const existing = await prisma.tournament.findUnique({ where: { hltvEventId: FAKE_EVENT_ID } });
  if (existing) {
    await prisma.match.deleteMany({ where: { stage: { tournamentId: existing.id } } });
    await prisma.stage.deleteMany({ where: { tournamentId: existing.id } });
    await prisma.tournamentTeam.deleteMany({ where: { tournamentId: existing.id } });
    await prisma.pickem.deleteMany({ where: { tournamentId: existing.id } });
  }

  const tournament = await prisma.tournament.upsert({
    where: { hltvEventId: FAKE_EVENT_ID },
    update: { lastSyncedAt: new Date() },
    create: {
      hltvEventId: FAKE_EVENT_ID,
      name: "Demo CS2 Major 2026",
      slug: "demo-cs2-major-2026",
      startDate: new Date(),
      lastSyncedAt: new Date(),
    },
  });

  const teamIds: string[] = [];
  for (let i = 0; i < TEAMS.length; i++) {
    const name = TEAMS[i];
    const team = await prisma.team.upsert({
      where: { hltvId: 900000 + i },
      update: { name },
      create: { hltvId: 900000 + i, name },
    });
    teamIds.push(team.id);
    await prisma.tournamentTeam.upsert({
      where: { tournamentId_teamId: { tournamentId: tournament.id, teamId: team.id } },
      update: {},
      create: { tournamentId: tournament.id, teamId: team.id, seed: i + 1 },
    });
  }

  for (const [kind, name] of [
    ["STAGE_1", "Stage 1 (Swiss)"],
    ["STAGE_2", "Stage 2 (Swiss)"],
    ["STAGE_3", "Stage 3 (Swiss)"],
    ["PLAYOFFS", "Playoffs"],
  ] as const) {
    const stage = await prisma.stage.upsert({
      where: { tournamentId_kind: { tournamentId: tournament.id, kind } },
      update: {},
      create: { tournamentId: tournament.id, kind, name },
    });

    if (kind === "PLAYOFFS") {
      // Empty 8-team single-elim bracket: 4 QFs, 2 SFs, 1 GF.
      for (let i = 0; i < 4; i++) {
        await prisma.match.create({
          data: {
            stageId: stage.id,
            bracketRound: 1,
            bracketSlot: i,
            teamAId: teamIds[i * 2] ?? null,
            teamBId: teamIds[i * 2 + 1] ?? null,
            bestOf: 3,
            status: "PENDING",
          },
        });
      }
      for (let i = 0; i < 2; i++) {
        await prisma.match.create({
          data: { stageId: stage.id, bracketRound: 2, bracketSlot: i, bestOf: 3, status: "PENDING" },
        });
      }
      await prisma.match.create({
        data: { stageId: stage.id, bracketRound: 3, bracketSlot: 0, bestOf: 5, status: "PENDING" },
      });
    } else {
      // Swiss: round 1 = 8 matches (16 teams paired up); rounds 2..5 are empty
      // placeholders the sync would normally fill once seedings resolve.
      for (let i = 0; i < 8; i++) {
        await prisma.match.create({
          data: {
            stageId: stage.id,
            swissRound: 1,
            teamAId: teamIds[i * 2] ?? null,
            teamBId: teamIds[i * 2 + 1] ?? null,
            bestOf: 1,
            status: "PENDING",
          },
        });
      }
    }
  }

  console.log(`✔ seeded "${tournament.name}" (id=${tournament.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
