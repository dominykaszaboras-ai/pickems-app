// One-off backfill: for every user that has a steamId, refresh their name
// and image from the public Steam community XML endpoint. Useful for users
// who signed in BEFORE the XML fetch was wired up — their User row still
// has the "Steam XXXX" placeholder.

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { PrismaClient } from "@prisma/client";
import { fetchSteamProfile } from "../lib/steam";

const p = new PrismaClient();

async function main() {
  const users = await p.user.findMany({
    where: { steamId: { not: null } },
    select: { id: true, name: true, image: true, steamId: true },
  });
  console.log(`Found ${users.length} Steam user(s).`);

  let updated = 0;
  for (const u of users) {
    if (!u.steamId) continue;
    const profile = await fetchSteamProfile(u.steamId);
    if (!profile.name && !profile.avatar) {
      console.log(`  ${u.steamId}: profile private / not found — skipped`);
      continue;
    }
    await p.user.update({
      where: { id: u.id },
      data: {
        name: profile.name ?? u.name ?? undefined,
        image: profile.avatar ?? u.image ?? undefined,
      },
    });
    console.log(`  ${u.steamId}: ${u.name} -> ${profile.name}, avatar: ${profile.avatar ? "set" : "missing"}`);
    updated++;
  }
  console.log(`Done. Updated ${updated} user(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
