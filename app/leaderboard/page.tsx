import { getActiveTournament, getAllPickems } from "@/lib/queries";
import { scorePickem } from "@/lib/scoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const tournament = await getActiveTournament();
  if (!tournament) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="text-xl font-semibold">No tournament loaded yet</h1>
      </main>
    );
  }

  const pickems = await getAllPickems(tournament.id);
  const rows = pickems
    .map((p) => ({ p, score: scorePickem(tournament, p) }))
    .sort((a, b) => b.score.total - a.score.total);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-2xl font-bold">Leaderboard</h1>
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
            <tr key={r.p.id} className="border-t border-line">
              <td className="px-3 py-2 text-muted">{i + 1}</td>
              <td className="px-3 py-2">{r.p.userName ?? "Anonymous"}</td>
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
                No pickems submitted yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
