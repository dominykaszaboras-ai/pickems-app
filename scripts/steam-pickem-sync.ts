// Periodic background sync between our DB and Valve's pickem system.
//
// For every user that has Steam linked + a Major Auth Code on file:
//
//   1. Pull their current predictions from Valve (handles the "user placed
//      picks in CS2 directly" case — those picks land in our DB so the
//      webapp form stays consistent with what they have on Steam).
//
//   2. After the local apply, attempt to push the user's PickemPick rows
//      BACK to Valve (handles the "the user saved picks in the webapp
//      while Valve's window was closed" case — once Valve opens the
//      relevant section, the next cron run lands the picks).
//
// Idempotent: re-uploading the same picks is a no-op; Valve returns 410
// for closed stages which we treat as success-equivalent.
//
// Runs from .github/workflows/steam-pickem-sync.yml, but can also be
// invoked locally with the same env vars as the regular sync scripts.

import { prisma } from "../lib/db";
import {
  extractPredictions,
  getTournamentLayout,
  getTournamentPredictions,
  localPicksToSteam,
  parseSteamLayout,
  steamPicksToLocal,
  uploadTournamentPredictions,
} from "../lib/steamPickems";
import { normalizeTeamName } from "../lib/liquipedia";
import type { StageKind } from "../lib/types";

const eventId = Number(process.env.STEAM_PICKEM_EVENT_ID ?? 0);
if (!eventId) {
  console.error("STEAM_PICKEM_EVENT_ID not set");
  process.exit(1);
}
const hltvEventId = Number(process.env.HLTV_EVENT_ID ?? 0);

// Throttle the cron so we don't hammer Valve when we have many users — at
// most ~20 outbound calls per minute (4 calls per user: layout-cached, get,
// upload, optionally another get-on-write).
const PER_USER_DELAY_MS = 3_000;

interface UserSyncResult {
  userId: string;
  name: string | null;
  pulled: number;
  applied: number;
  uploaded: number;
  uploadStatus: number | null;
  errors: string[];
}

async function syncOne(
  user: {
    id: string;
    name: string | null;
    steamId: string;
    steamPickemCode: string;
  },
  tournamentId: string | null,
): Promise<UserSyncResult> {
  const res: UserSyncResult = {
    userId: user.id,
    name: user.name,
    pulled: 0,
    applied: 0,
    uploaded: 0,
    uploadStatus: null,
    errors: [],
  };

  // ----- Pull (Steam -> webapp) ----------------------------------------
  let rawLayout: unknown;
  let rawPredictions: unknown;
  try {
    rawLayout = await getTournamentLayout(eventId);
    rawPredictions = await getTournamentPredictions(
      eventId,
      user.steamId,
      user.steamPickemCode,
    );
  } catch (e) {
    res.errors.push(`pull: ${(e as Error).message}`);
    return res;
  }

  const predictions = extractPredictions(rawPredictions);
  res.pulled = predictions.length;
  await prisma.user.update({
    where: { id: user.id },
    data: {
      steamPickemRaw: JSON.stringify({
        at: new Date().toISOString(),
        layout: rawLayout,
        predictions: rawPredictions,
      }),
    },
  });

  if (tournamentId && predictions.length > 0) {
    const parsed = parseSteamLayout(rawLayout);
    const teams = await prisma.team.findMany({
      where: {
        OR: [
          { tournaments: { some: { tournamentId } } },
          { matchesA: { some: { stage: { tournamentId } } } },
          { matchesB: { some: { stage: { tournamentId } } } },
        ],
      },
      select: { id: true, name: true },
    });
    const teamIdByNormalizedName = new Map(
      teams.map((t) => [normalizeTeamName(t.name), t.id]),
    );
    const localPicks = steamPicksToLocal(
      parsed,
      predictions,
      teamIdByNormalizedName,
      normalizeTeamName,
    );
    if (localPicks.length > 0) {
      const stagesApplied = [...new Set(localPicks.map((p) => p.stageKind))];
      await prisma.$transaction(async (tx) => {
        const pickem = await tx.pickem.upsert({
          where: { userId_tournamentId: { userId: user.id, tournamentId } },
          update: {},
          create: { userId: user.id, tournamentId },
        });
        await tx.pickemPick.deleteMany({
          where: { pickemId: pickem.id, stageKind: { in: stagesApplied as StageKind[] } },
        });
        await tx.pickemPick.createMany({
          data: localPicks.map((p) => ({
            pickemId: pickem.id,
            kind: p.kind,
            stageKind: p.stageKind,
            teamId: p.teamId,
            round: p.round,
          })),
        });
      });
      res.applied = localPicks.length;
    }
  }

  // ----- Push (webapp -> Steam) ----------------------------------------
  // We always attempt to push the user's current local picks back to
  // Valve. Repeated identical uploads are no-ops; 410/400 responses for
  // closed/unopened stages are logged but don't fail the cron.
  if (tournamentId) {
    const pickem = await prisma.pickem.findUnique({
      where: { userId_tournamentId: { userId: user.id, tournamentId } },
      include: { picks: true },
    });
    if (pickem && pickem.picks.length > 0) {
      const parsed = parseSteamLayout(rawLayout);
      const teamIds = Array.from(new Set(pickem.picks.map((p) => p.teamId)));
      const teams = await prisma.team.findMany({
        where: { id: { in: teamIds } },
        select: { id: true, name: true },
      });
      const teamNameById = new Map(teams.map((t) => [t.id, t.name]));
      const upload = localPicksToSteam(
        parsed,
        pickem.picks.map((p) => ({
          kind: p.kind as
            | "SWISS_3_0"
            | "SWISS_0_3"
            | "SWISS_ADVANCE"
            | "PLAYOFF_WINNER",
          stageKind: p.stageKind as StageKind,
          teamId: p.teamId,
          round: p.round,
        })),
        teamNameById,
        normalizeTeamName,
      );
      if (upload.length > 0) {
        try {
          const result = await uploadTournamentPredictions(
            eventId,
            user.steamId,
            user.steamPickemCode,
            upload,
          );
          res.uploaded = result.ok ? upload.length : 0;
          res.uploadStatus = result.status;
          if (!result.ok) {
            res.errors.push(`upload: ${result.status}`);
          }
        } catch (e) {
          res.errors.push(`upload: ${(e as Error).message}`);
        }
      }
    }
  }

  return res;
}

async function main() {
  const tournament = hltvEventId
    ? await prisma.tournament.findUnique({ where: { hltvEventId } })
    : await prisma.tournament.findFirst({ orderBy: { startDate: "desc" } });
  if (!tournament) {
    console.error("No active tournament — nothing to sync against.");
    process.exit(0);
  }

  const users = await prisma.user.findMany({
    where: {
      steamId: { not: null },
      steamPickemCode: { not: null },
    },
    select: { id: true, name: true, steamId: true, steamPickemCode: true },
  });
  console.log(
    `[steam-pickem-sync] ${users.length} user(s) eligible for sync against event ${eventId} (tournament: ${tournament.slug})`,
  );

  const results: UserSyncResult[] = [];
  for (const u of users) {
    if (!u.steamId || !u.steamPickemCode) continue;
    const result = await syncOne(
      { id: u.id, name: u.name, steamId: u.steamId, steamPickemCode: u.steamPickemCode },
      tournament.id,
    );
    results.push(result);
    console.log(
      `  - ${result.name ?? result.userId}: pulled=${result.pulled} applied=${result.applied} uploaded=${result.uploaded} status=${result.uploadStatus ?? "-"}${result.errors.length ? ` errors=${result.errors.join("; ")}` : ""}`,
    );
    await new Promise((r) => setTimeout(r, PER_USER_DELAY_MS));
  }

  const totals = {
    users: results.length,
    pulled: results.reduce((a, b) => a + b.pulled, 0),
    applied: results.reduce((a, b) => a + b.applied, 0),
    uploaded: results.reduce((a, b) => a + b.uploaded, 0),
    errored: results.filter((r) => r.errors.length).length,
  };
  console.log("[steam-pickem-sync] done", totals);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
