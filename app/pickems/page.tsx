import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getActiveTournament, getUserPickem } from "@/lib/queries";
import { PickemsForm } from "@/components/PickemsForm";
import { SteamSyncCard } from "@/components/SteamSyncCard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PickemsPage() {
  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) redirect("/auth/signin");

  const tournament = await getActiveTournament();
  if (!tournament) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="text-xl font-semibold">No tournament loaded yet</h1>
        <p className="mt-2 text-muted">
          Run the sync (set <code>HLTV_EVENT_ID</code> in <code>.env</code> and{" "}
          <code>npm run sync</code>) to import a Major from HLTV.
        </p>
      </main>
    );
  }

  const [initial, viewer] = await Promise.all([
    getUserPickem(userId, tournament.id),
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, steamId: true, steamPickemCode: true },
    }),
  ]);
  const hasSteam = Boolean(viewer?.steamId);

  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">{tournament.name}</h1>
        <p className="text-sm text-muted">Pickems</p>
      </header>
      {hasSteam ? (
        <div className="mb-6">
          <SteamSyncCard hasCodeOnFile={Boolean(viewer?.steamPickemCode)} />
        </div>
      ) : (
        viewer && (
          <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-panel/60 px-4 py-3 text-sm">
            <span className="text-muted">
              💡 Link your Steam account to auto-import the picks you submitted in-game.
            </span>
            <Link
              href={`/users/${viewer.id}`}
              className="rounded-md bg-panel2 px-3 py-1 text-xs font-medium hover:bg-line"
            >
              Link Steam →
            </Link>
          </div>
        )
      )}
      <PickemsForm tournament={tournament} initial={initial} />
    </main>
  );
}
