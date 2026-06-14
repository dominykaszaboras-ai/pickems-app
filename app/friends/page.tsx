import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { FriendsView } from "@/components/FriendsView";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function FriendsPage() {
  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) redirect("/auth/signin");

  return (
    <main className="mx-auto max-w-3xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Friends</h1>
        <p className="text-sm text-muted">
          Find other players on the site, send requests, and view their picks.
        </p>
      </header>
      <FriendsView />
    </main>
  );
}
