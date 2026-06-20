// Bootstrap a new Major / tournament end-to-end. Run once after wiring
// up the four env vars; everything downstream (Tournament row, Stages,
// match list, Liquipedia schedule, broadcast channels, playoff bracket
// structure) gets populated in one shot.
//
// Required env:
//   HLTV_EVENT_ID                — umbrella event id (e.g. 8500)
//   HLTV_STAGE_EVENTS            — "STAGE_1:9100,STAGE_2:9101,STAGE_3:9102"
//                                  Optional PLAYOFFS:<id> — usually shares
//                                  the umbrella id, in which case omit.
//   LIQUIPEDIA_TOURNAMENT_BASE   — e.g. "BLAST/Major/Berlin_2026"
//                                  Falls back to Cologne 2026 if unset.
// Optional env:
//   STEAM_PICKEM_EVENT_ID        — Valve's internal pickem id (probe with
//                                  scripts/probe-steam-pickem.ts)
//
// Usage:
//   DATABASE_URL="..." HLTV_EVENT_ID=8500 HLTV_STAGE_EVENTS="..." \
//   LIQUIPEDIA_TOURNAMENT_BASE="..." npx tsx scripts/setup-tournament.ts
//
// Idempotent: re-running just re-syncs everything. Existing matches keep
// their stage placement thanks to the lock added in lib/sync.ts.

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { prisma } from "../lib/db";
import { parseStageEvents, syncTournament } from "../lib/sync";
import { progressPlayoffBracket } from "../lib/bracket";
import {
  fetchSchedule,
  fetchTournamentBroadcasts,
  getLiquipediaStageMap,
  getLiquipediaUmbrella,
  normalizeTeamName,
} from "../lib/liquipedia";
import type { StageKind } from "../lib/types";

async function main() {
  const eventId = Number(process.env.HLTV_EVENT_ID ?? 0);
  if (!eventId) {
    console.error("HLTV_EVENT_ID is required");
    process.exit(1);
  }
  const stageEvents = parseStageEvents(process.env.HLTV_STAGE_EVENTS);
  const liquipediaBase = getLiquipediaUmbrella();
  const liquipediaStages = getLiquipediaStageMap();
  const steamPickemId = process.env.STEAM_PICKEM_EVENT_ID;

  console.log(`[setup] HLTV event           : ${eventId}`);
  console.log(`[setup] stage event mapping  : ${JSON.stringify(stageEvents)}`);
  console.log(`[setup] Liquipedia umbrella  : ${liquipediaBase}`);
  console.log(`[setup] Steam pickem id      : ${steamPickemId ?? "(not set)"}`);
  console.log("");

  // 1. Primary sync from HLTV — creates Tournament row, Stages, Teams,
  //    Matches. The widened ghost adoption + stageId lock keeps existing
  //    bracket placement intact across re-runs.
  console.log("[setup] step 1/3 — syncTournament (HLTV)");
  const syncResult = await syncTournament(eventId, stageEvents);
  console.log(`  → ${JSON.stringify(syncResult)}`);

  // 2. Liquipedia schedule sync — pulls upcoming match schedule + broadcast
  //    channels for stages where HLTV is incomplete or blocked.
  console.log("\n[setup] step 2/3 — Liquipedia schedule + broadcasts");
  try {
    const tournament = await prisma.tournament.findUnique({
      where: { hltvEventId: eventId },
      include: { stages: true },
    });
    if (!tournament) throw new Error("tournament row missing after HLTV sync");

    const stageIdByKind = new Map<StageKind, string>();
    for (const s of tournament.stages) {
      stageIdByKind.set(s.kind as StageKind, s.id);
    }
    const teams = await prisma.team.findMany({ select: { id: true, name: true } });
    const teamByName = new Map<string, string>();
    for (const t of teams) teamByName.set(normalizeTeamName(t.name), t.id);

    const broadcasts = await fetchTournamentBroadcasts(liquipediaBase);
    if (broadcasts.twitchChannel || broadcasts.youtubeChannel) {
      await prisma.tournament.update({
        where: { id: tournament.id },
        data: {
          twitchChannel: broadcasts.twitchChannel,
          youtubeChannel: broadcasts.youtubeChannel,
        },
      });
      console.log(
        `  → broadcasts twitch=${broadcasts.twitchChannel ?? "—"} youtube=${broadcasts.youtubeChannel ?? "—"}`,
      );
    } else {
      console.log("  → no broadcast channels found on Liquipedia umbrella");
    }

    const liquipediaMatches = await fetchSchedule(liquipediaStages);
    console.log(`  → Liquipedia returned ${liquipediaMatches.length} matches`);

    let upserted = 0;
    let skippedNoTeam = 0;
    const cutoff = Date.now() - 3 * 60 * 60 * 1000;
    for (const m of liquipediaMatches) {
      if (m.startTime.getTime() < cutoff) continue;
      const stageId = stageIdByKind.get(m.stageKind);
      if (!stageId) continue;
      const teamAId = m.teamAName ? teamByName.get(normalizeTeamName(m.teamAName)) : undefined;
      const teamBId = m.teamBName ? teamByName.get(normalizeTeamName(m.teamBName)) : undefined;
      if (!teamAId || !teamBId) {
        skippedNoTeam++;
        continue;
      }
      // Don't create a duplicate if HLTV already populated this match.
      const existing = await prisma.match.findFirst({
        where: {
          stageId,
          OR: [
            { teamAId, teamBId },
            { teamAId: teamBId, teamBId: teamAId },
          ],
        },
        select: { id: true },
      });
      if (existing) continue;
      await prisma.match.create({
        data: {
          stageId,
          teamAId,
          teamBId,
          startTime: m.startTime,
          bestOf: m.bestOf,
          status: "PENDING",
          scoreA: 0,
          scoreB: 0,
          hltvId: null,
          twitchUrl: m.twitchUrl,
          youtubeUrl: m.youtubeUrl,
        },
      });
      upserted++;
    }
    console.log(`  → created ${upserted} Liquipedia ghosts (skipped ${skippedNoTeam} for unknown teams)`);
  } catch (e) {
    console.warn(`  ! Liquipedia step failed (continuing): ${(e as Error).message}`);
  }

  // 3. Bracket auto-progression — ensures SF/Final placeholder rows exist
  //    and fills teamA/teamB from feeder winners. Idempotent.
  console.log("\n[setup] step 3/3 — progressPlayoffBracket");
  const tournament = await prisma.tournament.findUnique({
    where: { hltvEventId: eventId },
    select: { id: true },
  });
  if (tournament) {
    const r = await progressPlayoffBracket(tournament.id);
    console.log(`  → ${JSON.stringify(r)}`);
  }

  console.log("\n[setup] done. Run `gh workflow run \"HLTV sync\"` to start the 10-min cron.");
}

main()
  .catch((e) => {
    console.error("[setup] failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
