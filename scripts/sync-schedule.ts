// Daily pass that pulls upcoming match schedules from Liquipedia and writes
// them into the same Match table the HLTV sync feeds. We do this because
// HLTV.getMatches() (the official upcoming feed) often returns empty for
// our Major event — Cloudflare challenges turn into empty JSON, so the
// UpcomingSchedule component ends up with nothing to show.
//
// Run via:
//   npm run sync-schedule
// or on the daily GH Actions cron in .github/workflows/sync-schedule.yml.
//
// Idempotent: matching teams+stage are upserted in-place. When HLTV later
// publishes the same match with a real id, the regular sync's ghost-adoption
// pass attaches the hltvId to this row.

import { prisma } from "../lib/db";
import {
  COLOGNE_2026_LIQUIPEDIA,
  fetchSchedule,
  normalizeTeamName,
  type LiquipediaMatch,
} from "../lib/liquipedia";
import type { StageKind } from "../lib/types";

async function main() {
  const eventId = Number(process.env.HLTV_EVENT_ID ?? 0);
  if (!eventId) {
    console.error("HLTV_EVENT_ID not set — needed to identify which tournament to attach matches to");
    process.exit(1);
  }

  const tournament = await prisma.tournament.findUnique({
    where: { hltvEventId: eventId },
    include: { stages: true },
  });
  if (!tournament) {
    console.error(`No tournament in DB for HLTV event ${eventId}. Run the main sync first.`);
    process.exit(1);
  }

  const stageIdByKind = new Map<StageKind, string>();
  for (const s of tournament.stages) {
    stageIdByKind.set(s.kind as StageKind, s.id);
  }

  // Build a name -> teamId map keyed by normalized form so "FUT Esports"
  // (Liquipedia) matches "FUT" (HLTV).
  const teams = await prisma.team.findMany({ select: { id: true, name: true } });
  const teamIdByNormName = new Map<string, string>();
  for (const t of teams) {
    teamIdByNormName.set(normalizeTeamName(t.name), t.id);
  }

  console.log(`[schedule] fetching Liquipedia for ${tournament.name}`);
  const matches = await fetchSchedule(COLOGNE_2026_LIQUIPEDIA);
  console.log(`[schedule] Liquipedia returned ${matches.length} matches`);

  let upserted = 0;
  let skippedNoTeam = 0;
  let skippedNoStage = 0;
  let skippedPast = 0;

  // Cut off matches more than 3h in the past — those are already covered by
  // HLTV's results-driven sync and we don't want to ghost-revive them as
  // PENDING.
  const cutoff = Date.now() - 3 * 60 * 60 * 1000;

  for (const m of matches) {
    if (m.startTime.getTime() < cutoff) {
      skippedPast++;
      continue;
    }
    const stageId = stageIdByKind.get(m.stageKind);
    if (!stageId) {
      skippedNoStage++;
      continue;
    }
    const teamAId = m.teamAName ? teamIdByNormName.get(normalizeTeamName(m.teamAName)) : undefined;
    const teamBId = m.teamBName ? teamIdByNormName.get(normalizeTeamName(m.teamBName)) : undefined;
    if (!teamAId || !teamBId) {
      console.warn(`[schedule] could not resolve teams: ${m.teamAName} vs ${m.teamBName}`);
      skippedNoTeam++;
      continue;
    }

    // Dedupe: if a match already exists in this stage with the same pair of
    // teams (in either A/B order) AND is still PENDING, update its start
    // time/bestOf rather than creating a new row. Otherwise create.
    const existing = await prisma.match.findFirst({
      where: {
        stageId,
        status: "PENDING",
        OR: [
          { teamAId, teamBId },
          { teamAId: teamBId, teamBId: teamAId },
        ],
      },
      select: { id: true, startTime: true, bestOf: true, hltvId: true },
    });

    if (existing) {
      const sameTime = existing.startTime?.getTime() === m.startTime.getTime();
      const sameBo = existing.bestOf === m.bestOf;
      if (sameTime && sameBo) continue; // nothing to do
      await prisma.match.update({
        where: { id: existing.id },
        data: { startTime: m.startTime, bestOf: m.bestOf },
      });
      upserted++;
      continue;
    }

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
      },
    });
    upserted++;
  }

  // Garbage-collect Liquipedia ghosts that no longer appear in the upstream
  // schedule (e.g. match was cancelled or rescheduled across the cutoff).
  // We only delete rows we know we created — hltvId IS NULL ensures we never
  // touch an HLTV-sourced row.
  const liquipediaKey = (m: LiquipediaMatch) =>
    `${stageIdByKind.get(m.stageKind) ?? ""}|${m.startTime.getTime()}|${normalizeTeamName(m.teamAName ?? "")}|${normalizeTeamName(m.teamBName ?? "")}`;
  const liveKeys = new Set(matches.filter((m) => m.startTime.getTime() >= cutoff).map(liquipediaKey));

  const ghosts = await prisma.match.findMany({
    where: {
      hltvId: null,
      status: "PENDING",
      stage: { tournamentId: tournament.id },
    },
    include: { teamA: true, teamB: true, stage: true },
  });
  let removed = 0;
  for (const g of ghosts) {
    if (!g.startTime || !g.teamA || !g.teamB) continue;
    const fwd = `${g.stageId}|${g.startTime.getTime()}|${normalizeTeamName(g.teamA.name)}|${normalizeTeamName(g.teamB.name)}`;
    const rev = `${g.stageId}|${g.startTime.getTime()}|${normalizeTeamName(g.teamB.name)}|${normalizeTeamName(g.teamA.name)}`;
    if (liveKeys.has(fwd) || liveKeys.has(rev)) continue;
    await prisma.match.delete({ where: { id: g.id } });
    removed++;
  }

  console.log(
    `[schedule] upserted=${upserted} skippedPast=${skippedPast} skippedNoStage=${skippedNoStage} skippedNoTeam=${skippedNoTeam} ghostsRemoved=${removed}`,
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
