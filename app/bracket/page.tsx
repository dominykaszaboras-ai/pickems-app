import { auth } from "@/lib/auth";
import { getActiveTournament, getUserPickem } from "@/lib/queries";
import { BracketView } from "@/components/BracketView";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function BracketPage() {
  const tournament = await getActiveTournament();
  if (!tournament) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="text-xl font-semibold">No tournament loaded yet</h1>
        <p className="mt-2 text-muted">
          Set <code>HLTV_EVENT_ID</code> in <code>.env</code> and run <code>npm run sync</code>.
        </p>
      </main>
    );
  }

  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;
  const myPickem = userId ? await getUserPickem(userId, tournament.id) : null;

  return (
    <main className="mx-auto max-w-6xl p-4">
      <BracketView tournament={tournament} myPickem={myPickem} />
    </main>
  );
}
