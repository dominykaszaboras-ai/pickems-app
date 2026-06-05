import Link from "next/link";
import { getActiveTournament } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Home() {
  const t = await getActiveTournament();
  return (
    <main className="mx-auto max-w-4xl p-8">
      <div className="rounded-2xl border border-line bg-panel p-8">
        <h1 className="text-3xl font-bold">
          The <span className="text-accent">CS2 Major</span> Pickems Simulator
        </h1>
        <p className="mt-3 text-muted">
          See the live bracket, simulate any outcome, and watch your pickems score recompute instantly.
          Data syncs from HLTV every 10 minutes.
        </p>
        {t ? (
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <div className="rounded-xl border border-line bg-panel2 px-4 py-3">
              <div className="text-xs uppercase text-muted">Current major</div>
              <div className="text-lg font-semibold">{t.name}</div>
            </div>
            <Link href="/bracket" className="rounded-xl bg-accent px-5 py-3 font-semibold text-ink">
              Open bracket →
            </Link>
            <Link
              href="/pickems"
              className="rounded-xl border border-line bg-panel2 px-5 py-3 font-semibold"
            >
              Submit your pickems
            </Link>
          </div>
        ) : (
          <div className="mt-6 rounded-xl border border-line bg-panel2 p-4 text-sm">
            No tournament loaded yet. Set <code>HLTV_EVENT_ID</code> in your <code>.env</code> and run{" "}
            <code>npm run sync</code> to import a Major from HLTV.
          </div>
        )}
      </div>
    </main>
  );
}
