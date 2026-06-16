// Probe Valve's UploadTournamentPredictions/v1 with a no-op (re-uploads
// the picks the user already has on Steam). Useful for:
//   - Confirming we've guessed the body shape right
//   - Iterating on the format if Valve rejects it
//
// Usage:
//   DATABASE_URL=... STEAM_API_KEY=... STEAM_PICKEM_EVENT_ID=26 \
//     npx tsx scripts/probe-steam-upload.ts <userId>
//
// Reads the user's stored steamId + steamPickemCode + steamPickemRaw from
// the DB (no fresh Steam fetch). Re-uploads whatever picks are in the
// stored raw payload — so if Valve has already accepted those picks, this
// is a no-op confirmation. If Valve rejects, the response body tells us
// the format we need.
//
// IMPORTANT: this WILL hit the Valve POST endpoint. It cannot create new
// picks the user didn't already make — it's intentionally limited to
// echoing the user's existing predictions back.

import { prisma } from "../lib/db";
import {
  extractPredictions,
  parseSteamLayout,
  uploadTournamentPredictions,
} from "../lib/steamPickems";

const userId = process.argv[2];
if (!userId) {
  console.error("Usage: probe-steam-upload.ts <userId>");
  process.exit(1);
}

const eventId = Number(process.env.STEAM_PICKEM_EVENT_ID ?? 0);
if (!eventId) {
  console.error("STEAM_PICKEM_EVENT_ID not set");
  process.exit(1);
}

async function main() {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { steamId: true, steamPickemCode: true, steamPickemRaw: true, name: true },
  });
  if (!u?.steamId || !u.steamPickemCode || !u.steamPickemRaw) {
    console.error(
      "User missing one of: steamId, steamPickemCode, steamPickemRaw. Run a /pickems sync first.",
    );
    process.exit(1);
  }
  console.log(`User: ${u.name} (steamid=${u.steamId})`);

  const raw = JSON.parse(u.steamPickemRaw);
  const predictions = extractPredictions(raw.predictions);
  console.log(`Extracted ${predictions.length} picks from stored raw.`);

  // Resolve each pick's groupid -> sectionid via the cached layout.
  const layout = parseSteamLayout(raw.layout);
  const sectionByGroup = new Map<number, number>();
  for (const v of layout.bySlot.values()) {
    sectionByGroup.set(v.groupid, v.sectionid);
  }
  const payload = predictions
    .map((p) => {
      const sectionid = sectionByGroup.get(p.groupid);
      if (sectionid == null) return null;
      return {
        sectionid,
        groupid: p.groupid,
        index: p.index,
        pick: p.pickid,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  console.log(`Uploading ${payload.length} picks to Valve...`);
  const res = await uploadTournamentPredictions(
    eventId,
    u.steamId,
    u.steamPickemCode,
    payload,
  );
  console.log("Status:", res.status, res.ok ? "OK" : "FAIL");
  console.log("Body:");
  console.log(
    typeof res.body === "string"
      ? res.body
      : JSON.stringify(res.body, null, 2),
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
