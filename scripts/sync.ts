// Manual sync runner — useful for local dev and one-off backfills.
// Usage:  npm run sync   (or)   npx tsx scripts/sync.ts

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd()); // reads .env, .env.local, etc — same as Next.

import { parseStageEvents, syncTournament } from "../lib/sync";

const eventId = Number(process.env.HLTV_EVENT_ID ?? 0);
if (!eventId) {
  console.error("HLTV_EVENT_ID is required");
  process.exit(1);
}

const stageEvents = parseStageEvents(process.env.HLTV_STAGE_EVENTS);
if (Object.keys(stageEvents).length > 0) {
  console.log("[sync] stage event mapping:", stageEvents);
}

syncTournament(eventId, stageEvents)
  .then((r) => {
    console.log("[sync] done", r);
    process.exit(0);
  })
  .catch((e) => {
    console.error("[sync] failed", e);
    process.exit(1);
  });
