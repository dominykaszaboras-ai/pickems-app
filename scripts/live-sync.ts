// Fast live-only sync runner. Hits HLTV.getMatch for any match we currently
// track as LIVE (or PENDING-but-imminent) and updates its scoreA/scoreB/
// status. Run every couple of minutes from .github/workflows/live-sync.yml.

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { syncLiveMatches } from "../lib/sync";

syncLiveMatches()
  .then((r) => {
    console.log("[live-sync] done", r);
    process.exit(0);
  })
  .catch((e) => {
    console.error("[live-sync] failed", e);
    process.exit(1);
  });
