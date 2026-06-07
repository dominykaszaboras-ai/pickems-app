// Inspect what's actually saved in PickemPick rows, joined to team names —
// helps diagnose "bracket shows picks I didn't make" reports.

import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  const pickems = await p.pickem.findMany({
    include: {
      user: { select: { name: true, email: true, steamId: true } },
      picks: true,
    },
  });

  if (pickems.length === 0) {
    console.log("No pickems saved.");
    return;
  }

  // Resolve teamIds in one shot.
  const allTeamIds = new Set<string>();
  for (const pk of pickems) for (const p of pk.picks) allTeamIds.add(p.teamId);
  const teams = await p.team.findMany({ where: { id: { in: [...allTeamIds] } }, select: { id: true, name: true } });
  const nameById = new Map(teams.map((t) => [t.id, t.name]));

  for (const pk of pickems) {
    const who = pk.user.name ?? pk.user.email ?? pk.user.steamId ?? pk.userId;
    console.log(`\n=== ${who} (pickem ${pk.id}, ${pk.picks.length} picks) ===`);
    const byStage: Record<string, string[]> = {};
    for (const pick of pk.picks) {
      const key = `${pick.stageKind} ${pick.kind}${pick.round != null ? "/R" + pick.round : ""}`;
      const teamName = nameById.get(pick.teamId) ?? `<orphan teamId=${pick.teamId}>`;
      (byStage[key] ||= []).push(teamName);
    }
    const keys = Object.keys(byStage).sort();
    for (const k of keys) {
      console.log(`  ${k.padEnd(28)} ${byStage[k].sort().join(", ")}`);
    }
  }
}

main().finally(() => p.$disconnect());
