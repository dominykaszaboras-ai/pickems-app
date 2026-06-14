// Public profile page for a single user.
//
// Pick visibility is gated per-stage: a stage's picks are only shown once
// at least one match in that stage has gone LIVE or FINISHED. This stops
// pre-deadline copying — same model majors.im uses.
//
// The page itself is publicly viewable (no auth wall) so people can share
// profile links. The Add-friend button is rendered only for signed-in
// non-self viewers.

import { auth } from "@/lib/auth";
import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import {
  getActiveTournament,
  getUserPickem,
} from "@/lib/queries";
import { scorePickem } from "@/lib/scoring";
import { PickSummary } from "@/components/PickSummary";
import { FriendButton, type ProfileFriendStatus } from "@/components/FriendButton";
import { loadFriendGraph, statusOf } from "@/lib/friends";
import { STAGE_LABEL, type ClientTeam, type StageKind } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ProfilePage({ params }: { params: { id: string } }) {
  // Short-circuit obviously-bogus ids before hitting the DB.
  if (!params.id || params.id.length > 64) notFound();

  const profile = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, image: true, steamId: true },
  });
  if (!profile) notFound();

  const session = await auth();
  const viewerId = (session?.user as any)?.id as string | undefined;

  // Determine the viewer's friend relationship to this profile.
  let friendStatus: ProfileFriendStatus = "anon";
  let friendshipId: string | null = null;
  if (viewerId) {
    if (viewerId === profile.id) {
      friendStatus = "self";
    } else {
      const graph = await loadFriendGraph(viewerId);
      friendStatus = statusOf(graph, viewerId, profile.id) as ProfileFriendStatus;
      friendshipId = graph.friendshipIdByOther.get(profile.id) ?? null;
    }
  }

  const tournament = await getActiveTournament();
  const pickem = tournament ? await getUserPickem(profile.id, tournament.id) : null;
  const score = tournament && pickem ? scorePickem(tournament, pickem) : null;

  // Stage is "unlocked" once at least one match in it has gone LIVE/FINISHED
  // AND its scheduled startTime is in the past. We require both because a
  // pure status check would expose every user's picks if the sync mis-marks
  // a match LIVE before it actually starts (HLTV/Liquipedia feed lag has
  // bitten us before); and a pure clock check would expose picks for matches
  // that got pushed back. Belt + braces.
  const nowMs = Date.now();
  const unlocked = new Set<StageKind>();
  if (tournament) {
    for (const stage of tournament.stages) {
      const anyLive = stage.matches.some(
        (m) =>
          (m.status === "LIVE" || m.status === "FINISHED") &&
          m.startTime !== null &&
          new Date(m.startTime).getTime() <= nowMs,
      );
      if (anyLive) unlocked.add(stage.kind);
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {profile.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.image}
              alt=""
              width={56}
              height={56}
              className="rounded-full border border-line"
            />
          ) : (
            <div className="h-14 w-14 rounded-full border border-line bg-panel2" />
          )}
          <div>
            <h1 className="text-2xl font-bold">{profile.name ?? "Anonymous"}</h1>
            <div className="text-xs text-muted">
              {profile.steamId ? "Steam account" : "Email account"}
            </div>
          </div>
        </div>
        <FriendButton
          profileUserId={profile.id}
          initialStatus={friendStatus}
          initialFriendshipId={friendshipId}
        />
      </div>

      {!tournament && (
        <div className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">
          No tournament loaded yet.
        </div>
      )}

      {tournament && !pickem && (
        <div className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">
          This user hasn't submitted picks for {tournament.name}.
        </div>
      )}

      {tournament && pickem && score && (
        <section className="flex flex-col gap-6">
          <div className="rounded-2xl border border-line bg-panel p-4">
            <div className="mb-2 text-xs uppercase text-muted">Score · {tournament.name}</div>
            <div className="flex items-baseline gap-6">
              <div className="font-mono text-3xl text-accent">{score.total}</div>
              <div className="flex flex-wrap gap-3 text-xs text-muted">
                <StageScore label="S1" value={score.byStage.STAGE_1} />
                <StageScore label="S2" value={score.byStage.STAGE_2} />
                <StageScore label="S3" value={score.byStage.STAGE_3} />
                <StageScore label="PO" value={score.byStage.PLAYOFFS} />
              </div>
            </div>
            <div className="mt-2">
              <Link href="/leaderboard" className="text-xs text-muted hover:text-accent">
                View full leaderboard →
              </Link>
            </div>
          </div>

          {tournament.stages.map((stage) => {
            const isUnlocked = unlocked.has(stage.kind);
            const teamsById = new Map<string, ClientTeam>();
            for (const t of stage.teams) teamsById.set(t.id, t);
            // Also include the union of tournament.teams so PLAYOFFS picks
            // (whose stage hasn't been populated yet) still render team logos.
            for (const t of tournament.teams) {
              if (!teamsById.has(t.id)) teamsById.set(t.id, t);
            }

            return (
              <div key={stage.id} className="rounded-2xl border border-line bg-panel p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-lg font-semibold">{STAGE_LABEL[stage.kind]}</h2>
                  {!isUnlocked && (
                    <span className="rounded bg-panel2 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                      Locked until stage starts
                    </span>
                  )}
                </div>
                {isUnlocked ? (
                  <PickSummary stage={stage} score={score} teamsById={teamsById} />
                ) : (
                  <div className="rounded-xl border border-dashed border-line bg-panel/40 p-3 text-xs text-muted">
                    {profile.name ?? "This user"}'s {STAGE_LABEL[stage.kind]} picks
                    will appear here once the first match of that stage goes live.
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}
    </main>
  );
}

function StageScore({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-1">
      <span>{label}</span>
      <span className="font-mono text-text">{value}</span>
    </div>
  );
}
