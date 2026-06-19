// One-off cleanup: move Match rows that were mis-stored on STAGE_3 back to
// PLAYOFFS, and dedupe any orphan PENDING PLAYOFFS rows that the daily
// Liquipedia GC may have left behind.
//
// Why this exists: Cologne 2026's HLTV event 8301 is BOTH the umbrella AND
// the STAGE_3 source AND hosts playoff matches under the same event id.
// Before the disambiguation fix landed in `lib/hltv.ts:fetchStageMatches`,
// every playoff QF result that came in from HLTV was force-tagged STAGE_3
// and written to a fresh STAGE_3-stage Match row. Meanwhile the original
// PLAYOFFS Liquipedia-sourced PENDING row sat orphaned (hltvId=null, never
// adopted) and got deleted by `scripts/sync-schedule.ts` on the next 05:30
// UTC run.
//
// Net effect on /bracket: playoff QF tiles disappear one by one as their
// matches conclude, and `scorePlayoffs` can't credit correct QF picks
// because the result lives on a STAGE_3 row, invisible to playoff scoring.
//
// Heuristic for "this STAGE_3 row is actually a playoff match":
//   (a) both teams also appear in the PLAYOFFS stage of the same tournament
//       (anyone in any PLAYOFFS row is a "playoff team"), AND
//   (b) startTime > --afterDate (a configurable cutoff for "when Stage 3
//       ended"). This is required because in a 16-team Swiss the top-8
//       teams absolutely DO play each other inside the group stage, so the
//       team-pair check alone catches too many legitimate Stage 3 matches.
//
// Alternatively, pass --hltvIds=A,B,… to move exactly those matches without
// the heuristic.
//
// PickemPick rows are NOT touched — they key by (stageKind, teamId, round,
// kind), not by matchId, so moving a Match row between stages doesn't
// invalidate any pick.
//
// Usage (dry-run by default — pass --apply to actually mutate):
//   DATABASE_URL="…" HLTV_EVENT_ID=8301 npx tsx scripts/fix-playoff-stage.ts
//   DATABASE_URL="…" HLTV_EVENT_ID=8301 npx tsx scripts/fix-playoff-stage.ts --apply
//
// Optional flags:
//   --bracketRound=N   Force a specific bracketRound for moved rows (default: 1, QF).
//   --hltvIds=A,B,C    Move exactly these HLTV match ids (skips the team-pair heuristic).
//   --afterDate=YYYY-MM-DD  When using the heuristic, only consider STAGE_3 matches
//                          whose startTime is strictly AFTER this date.

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");
const BRACKET_ROUND_ARG = process.argv.find((a) => a.startsWith("--bracketRound="));
const BRACKET_ROUND = BRACKET_ROUND_ARG ? Number(BRACKET_ROUND_ARG.split("=")[1]) : 1;
const HLTV_IDS_ARG = process.argv.find((a) => a.startsWith("--hltvIds="));
const HLTV_ID_FILTER: Set<number> | null = HLTV_IDS_ARG
  ? new Set(HLTV_IDS_ARG.split("=")[1].split(",").map((s) => Number(s.trim())).filter(Boolean))
  : null;
const AFTER_DATE_ARG = process.argv.find((a) => a.startsWith("--afterDate="));
const AFTER_DATE: Date | null = AFTER_DATE_ARG
  ? new Date(AFTER_DATE_ARG.split("=")[1] + "T00:00:00Z")
  : null;

async function main() {
  const eventId = Number(process.env.HLTV_EVENT_ID ?? 0);
  if (!eventId) {
    console.error("HLTV_EVENT_ID not set — needed to find the current tournament");
    process.exit(1);
  }

  const tournament = await prisma.tournament.findUnique({
    where: { hltvEventId: eventId },
    include: { stages: true },
  });
  if (!tournament) {
    console.error(`No tournament for HLTV event ${eventId}.`);
    process.exit(1);
  }

  const stage3 = tournament.stages.find((s) => s.kind === "STAGE_3");
  const playoffs = tournament.stages.find((s) => s.kind === "PLAYOFFS");
  if (!stage3 || !playoffs) {
    console.error(
      `Tournament missing required stages — stage3=${!!stage3} playoffs=${!!playoffs}`,
    );
    process.exit(1);
  }

  console.log(
    `[fix-playoff-stage] tournament=${tournament.name} mode=${APPLY ? "APPLY" : "DRY-RUN"} bracketRound=${BRACKET_ROUND}` +
      (HLTV_ID_FILTER ? ` hltvIds=${[...HLTV_ID_FILTER].join(",")}` : ""),
  );

  // 1. Build the set of teams that participate in playoffs. Anyone who
  //    appears (as teamA or teamB) in any PLAYOFFS row is a playoff team.
  const playoffMatches = await prisma.match.findMany({
    where: { stageId: playoffs.id },
    select: { teamAId: true, teamBId: true, teamA: { select: { name: true } }, teamB: { select: { name: true } } },
  });
  const playoffTeamIds = new Set<string>();
  for (const m of playoffMatches) {
    if (m.teamAId) playoffTeamIds.add(m.teamAId);
    if (m.teamBId) playoffTeamIds.add(m.teamBId);
  }
  console.log(
    `[fix-playoff-stage] PLAYOFFS stage currently has ${playoffMatches.length} match(es), ${playoffTeamIds.size} unique team(s):`,
  );
  for (const m of playoffMatches) {
    console.log(`  - ${m.teamA?.name ?? "?"} vs ${m.teamB?.name ?? "?"}`);
  }

  if (playoffTeamIds.size < 4) {
    console.warn(
      `[fix-playoff-stage] WARNING: only ${playoffTeamIds.size} unique playoff teams found via existing PLAYOFFS rows. ` +
        `If the bracket isn't well-seeded yet, this heuristic may miss matches. Consider using --hltvIds=… explicitly.`,
    );
  }

  // 2. Find STAGE_3 matches where BOTH teams are in playoffTeamIds. Those
  //    are the misfiled playoff matches (Swiss doesn't repeat matchups, so
  //    two playoff teams playing each other in STAGE_3 means HLTV's
  //    force-tagging mis-stored a playoff result).
  const stage3Matches = await prisma.match.findMany({
    where: { stageId: stage3.id },
    include: {
      teamA: { select: { id: true, name: true } },
      teamB: { select: { id: true, name: true } },
    },
  });

  const candidates = stage3Matches.filter((m) => {
    if (!m.teamAId || !m.teamBId) return false;
    // Explicit hltvIds list short-circuits the heuristic.
    if (HLTV_ID_FILTER) return m.hltvId != null && HLTV_ID_FILTER.has(m.hltvId);
    // Heuristic mode: both teams in PLAYOFFS team set AND startTime after the
    // configured Stage-3-ended cutoff. Without --afterDate the heuristic
    // refuses to move anything (in Swiss the top-8 teams play each other in
    // the group stage too, so the team-pair signal alone catches too much).
    if (!playoffTeamIds.has(m.teamAId)) return false;
    if (!playoffTeamIds.has(m.teamBId)) return false;
    if (!AFTER_DATE) return false;
    if (!m.startTime || m.startTime.getTime() <= AFTER_DATE.getTime()) return false;
    return true;
  });

  if (candidates.length === 0 && !HLTV_ID_FILTER && !AFTER_DATE) {
    console.log(
      `\n[fix-playoff-stage] No mode selected — pass either --hltvIds=… or --afterDate=YYYY-MM-DD to identify misfiled rows.`,
    );
  }

  console.log(`\n[fix-playoff-stage] candidates (STAGE_3 matches between two playoff teams):`);
  for (const m of candidates) {
    console.log(
      `  - ${m.teamA?.name ?? "?"} vs ${m.teamB?.name ?? "?"}  status=${m.status} hltvId=${m.hltvId ?? "null"} startTime=${m.startTime?.toISOString() ?? "null"}`,
    );
  }

  if (candidates.length === 0) {
    console.log("\n[fix-playoff-stage] nothing to do.");
    return;
  }

  let moved = 0;
  let orphansDeleted = 0;
  let duplicatesWarned = 0;

  for (const m of candidates) {
    if (!m.teamAId || !m.teamBId) continue;

    // Look for any sibling PLAYOFFS row with the same team pair (in either
    // order). If it's an orphan PENDING (hltvId IS NULL), delete it — the
    // moved STAGE_3 row supersedes it. If it's already adopted (hltvId set),
    // we have a real duplicate — log and skip.
    const siblings = await prisma.match.findMany({
      where: {
        stageId: playoffs.id,
        OR: [
          { teamAId: m.teamAId, teamBId: m.teamBId },
          { teamAId: m.teamBId, teamBId: m.teamAId },
        ],
      },
      select: { id: true, hltvId: true, status: true },
    });

    const adoptedSibling = siblings.find((s) => s.hltvId != null);
    if (adoptedSibling) {
      console.warn(
        `  ! ${m.teamA?.name} vs ${m.teamB?.name}: PLAYOFFS already has an adopted sibling (id=${adoptedSibling.id}, hltvId=${adoptedSibling.hltvId}). Skipping; operator should investigate.`,
      );
      duplicatesWarned++;
      continue;
    }

    for (const ghost of siblings) {
      if (APPLY) {
        await prisma.match.delete({ where: { id: ghost.id } });
      }
      orphansDeleted++;
    }
    if (APPLY) {
      await prisma.match.update({
        where: { id: m.id },
        data: {
          stageId: playoffs.id,
          bracketRound: BRACKET_ROUND,
        },
      });
    }
    moved++;
    console.log(
      `  → moved ${m.teamA?.name} vs ${m.teamB?.name} to PLAYOFFS, bracketRound=${BRACKET_ROUND}` +
        (siblings.length ? ` (deleted ${siblings.length} orphan ghost(s))` : " (no sibling)"),
    );
  }

  // 3. Post-move verification.
  const playoffsAfter = await prisma.match.count({ where: { stageId: playoffs.id } });
  const qfAfter = await prisma.match.count({
    where: { stageId: playoffs.id, bracketRound: 1 },
  });

  console.log("");
  console.log(`[fix-playoff-stage] summary:`);
  console.log(`  candidates scanned   : ${candidates.length}`);
  console.log(`  moved STAGE_3 -> PLAYOFFS: ${moved}`);
  console.log(`  orphan ghosts deleted: ${orphansDeleted}`);
  console.log(`  duplicate warnings   : ${duplicatesWarned}`);
  console.log(`  PLAYOFFS rows total  : ${playoffsAfter}`);
  console.log(`  PLAYOFFS QF rows (bracketRound=1) : ${qfAfter}`);

  if (!APPLY) {
    console.log("");
    console.log("DRY-RUN: no rows were mutated. Re-run with --apply to commit.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
