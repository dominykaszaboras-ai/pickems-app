// Step 1 of the Steam-LINK OpenID dance.
//
// Unlike /api/auth/steam (which signs the user in or creates a Steam-only
// account on first contact), this endpoint links a SteamID to an ALREADY
// signed-in user. Visiting it without a session bounces to /auth/signin.
//
// We use a separate return_to (/api/auth/steam/link/callback) so the
// regular-signin callback handler doesn't accidentally try to upsert a
// fresh Steam account when the intent was "attach Steam to my existing
// email account".

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { buildRedirectUrl } from "@/lib/steam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function originOf(req: NextRequest): string {
  const fromEnv = process.env.AUTH_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  const viewerId = (session?.user as any)?.id as string | undefined;
  const origin = originOf(req);

  // Not signed in → send to sign-in page with a hint, then they can retry.
  if (!viewerId) {
    return NextResponse.redirect(`${origin}/auth/signin?error=link_requires_signin`);
  }

  const returnTo = `${origin}/api/auth/steam/link/callback`;
  const realm = origin + "/";
  return NextResponse.redirect(buildRedirectUrl(returnTo, realm));
}
