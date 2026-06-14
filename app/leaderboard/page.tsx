import Link from "next/link";
import { auth } from "@/lib/auth";
import { getActiveTournament, getAllPickems } from "@/lib/queries";
import { scorePickem } from "@/lib/scoring";
import { loadFriendGraph } from "@/lib/friends";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Optional ?friends=1 toggle filters to the viewer + their accepted friends.
// Server-rendered (no client JS) — the toggle is just two anchor links.

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const tournament = await getActiveTournament();
  if (!tournament) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="text-xl font-semibold">No tournament loaded yet</h1>
      </main>
    );
  }

  const session = await auth();
  const viewerId = (session?.user as any)?.id as string | undefined;
  const friendsOnly = searchParams?.friends === "1";

  // For the friends-only filter we need the viewer's accepted friend set.
  // For unauthenticated viewers the toggle is hidden, so we skip the lookup.
  let friendIds: Set<string> | null = null;
  if (viewerId && friendsOnly) {
    const graph = await loadFriendGraph(viewerId);
    friendIds = new Set([viewerId, ...graph.acceptedIds]);
  }

  let pickems = await getAllPickems(tournament.id);
  if (friendIds) {
    pickems = pickems.filter((p) => friendIds!.has(p.userId));
  }

  const rows = pickems
    .map((p) => ({ p, score: scorePickem(tournament, p) }))
    .sort((a, b) => b.score.total - a.score.total);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="mb-1 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Leaderboard</h1>
        {viewerId && (
          <div className="flex overflow-hidden rounded-xl border border-line text-xs">
            <Link
              href="/leaderboard"
              className={
                "px-3 py-1 " +
                (!friendsOnly ? "bg-accent text-ink" : "text-muted hover:text-text")
              }
            >
              Everyone
            </Link>
            <Link
              href="/leaderboard?friends=1"
              className={
                "px-3 py-1 " +
                (friendsOnly ? "bg-accent text-ink" : "text-muted hover:text-text")
              }
            >
              Friends only
            </Link>
          </div>
        )}
      </div>
      <p className="mb-6 text-sm text-muted">{tournament.name}</p>
      <table className="w-full overflow-hidden rounded-2xl border border-line">
        <thead className="bg-panel2 text-xs uppercase text-muted">
          <tr>
            <th className="px-3 py-2 text-left">#</th>
            <th className="px-3 py-2 text-left">Player</th>
            <th className="px-3 py-2 text-right">S1</th>
            <th className="px-3 py-2 text-right">S2</th>
            <th className="px-3 py-2 text-right">S3</th>
            <th className="px-3 py-2 text-right">PO</th>
            <th className="px-3 py-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody className="bg-panel">
          {rows.map((r, i) => (
            <tr key={r.p.id} className="border-t border-line hover:bg-panel2/60">
              <td className="px-3 py-2 text-muted">{i + 1}</td>
              <td className="px-3 py-2">
                <Link
                  href={`/users/${r.p.userId}`}
                  className="flex items-center gap-2 hover:text-accent"
                >
                  {r.p.userImage && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.p.userImage}
                      alt=""
                      width={20}
                      height={20}
                      className="rounded-full border border-line"
                    />
                  )}
                  <span>{r.p.userName ?? "Anonymous"}</span>
                </Link>
              </td>
              <td className="px-3 py-2 text-right font-mono">{r.score.byStage.STAGE_1}</td>
              <td className="px-3 py-2 text-right font-mono">{r.score.byStage.STAGE_2}</td>
              <td className="px-3 py-2 text-right font-mono">{r.score.byStage.STAGE_3}</td>
              <td className="px-3 py-2 text-right font-mono">{r.score.byStage.PLAYOFFS}</td>
              <td className="px-3 py-2 text-right font-mono font-semibold text-accent">
                {r.score.total}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-6 text-center text-muted">
                {friendsOnly
                  ? "None of your friends have submitted picks yet."
                  : "No pickems submitted yet."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
