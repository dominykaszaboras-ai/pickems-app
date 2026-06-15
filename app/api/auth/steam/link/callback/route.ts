// Step 2 of the Steam-LINK OpenID dance.
//
// Verify Steam's response, then attach the SteamID64 to the currently
// signed-in user. Refuses if:
//   - viewer isn't signed in (someone hand-crafted the URL)
//   - viewer already has a SteamID linked (use Unlink first to swap)
//   - the SteamID is already attached to a different user (P2002)
//
// Profile metadata (name + image) is filled in only when the current row
// has none — we never overwrite a custom name the user already set.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fetchSteamProfile, verifyCallback } from "@/lib/steam";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function trustedOrigin(req: NextRequest): { origin: string; host: string } {
  const fromEnv = process.env.AUTH_URL;
  if (fromEnv) {
    const u = new URL(fromEnv);
    return { origin: `${u.protocol}//${u.host}`, host: u.host };
  }
  const u = new URL(req.url);
  return { origin: `${u.protocol}//${u.host}`, host: u.host };
}

export async function GET(req: NextRequest) {
  const { origin, host } = trustedOrigin(req);
  const session = await auth();
  const viewerId = (session?.user as any)?.id as string | undefined;

  // Profile page we redirect to with feedback query strings.
  const profilePath = (q: string) =>
    `${origin}/users/${viewerId ?? ""}${q ? `?${q}` : ""}`;

  if (!viewerId) {
    return NextResponse.redirect(`${origin}/auth/signin?error=link_requires_signin`);
  }

  // 1. Ask Steam to confirm the response is genuine. We re-use the same
  //    host check as the sign-in callback — Steam echoes our return_to
  //    back to us; if the host doesn't match, this isn't ours.
  const steamId = await verifyCallback(req.nextUrl.searchParams, host);
  if (!steamId) {
    return NextResponse.redirect(profilePath("error=steam_verify_failed"));
  }

  // 2. Check current viewer row to give a clear "already linked" message
  //    before we hit the unique-violation path.
  const me = await prisma.user.findUnique({
    where: { id: viewerId },
    select: { steamId: true, name: true, image: true },
  });
  if (!me) {
    // Session points at a deleted user — bounce to signin.
    return NextResponse.redirect(`${origin}/auth/signin?error=session_stale`);
  }
  if (me.steamId === steamId) {
    return NextResponse.redirect(profilePath("linked=already_yours"));
  }
  if (me.steamId) {
    return NextResponse.redirect(profilePath("error=already_linked"));
  }

  // 3. Pull a fresh Steam profile snapshot. We only fill name/image if the
  //    existing row has none, so email users with custom display names
  //    keep them.
  const profile = await fetchSteamProfile(steamId);

  try {
    await prisma.user.update({
      where: { id: viewerId },
      data: {
        steamId,
        name: me.name ?? profile.name ?? undefined,
        image: me.image ?? profile.avatar ?? undefined,
      },
    });
  } catch (e) {
    // P2002 on steamId → another User row already owns this SteamID.
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return NextResponse.redirect(profilePath("error=steam_taken"));
    }
    console.error("[steam-link-callback] update failed", e);
    return NextResponse.redirect(profilePath("error=link_failed"));
  }

  return NextResponse.redirect(profilePath("linked=1"));
}
