import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getActiveTournament, getUserPickem } from "@/lib/queries";
import { PickemsForm } from "@/components/PickemsForm";
import { SteamSyncCard } from "@/components/SteamSyncCard";
import { prisma } from "@/lib/db";

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

  const initial = await getUserPickem(userId, tournament.id);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { steamId: true },
  });

  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">{tournament.name}</h1>
        <p className="text-sm text-muted">Pickems</p>
      </header>
      {user?.steamId ? (
        <div className="mb-8">
          <SteamSyncCard />
        </div>
      ) : (
        <div className="mb-8 rounded-xl border border-line bg-panel2 p-4 text-sm text-muted">
          Sign in with Steam to import the pickems you submitted on
          counter-strike.net / in CS2 — paste your{" "}
          <strong className="text-text">Major Auth Code</strong> here and we'll
          pull them directly from Valve.
        </div>
      )}
      <PickemsForm tournament={tournament} initial={initial} />
    </main>
  );
}
