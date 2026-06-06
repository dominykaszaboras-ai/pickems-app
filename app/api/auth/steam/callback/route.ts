// Step 2 of the Steam OpenID dance: verify Steam's response, HMAC-sign the
// SteamID, then hand it off to NextAuth's `steam` credentials provider to
// upsert the user and set the session cookie.

import { NextRequest, NextResponse } from "next/server";
import { signIn } from "@/lib/auth";
import { signSteamId, verifyCallback } from "@/lib/steam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  // 1. Ask Steam to confirm the response is genuine (mode=check_authentication).
  const steamId = await verifyCallback(url.searchParams);
  if (!steamId) {
    const back = new URL("/auth/signin?error=steam_verify_failed", url.origin);
    return NextResponse.redirect(back);
  }

  // 2. HMAC-sign the steamId with AUTH_SECRET so only this callback can hand
  //    it to the `steam` credentials provider.
  const token = signSteamId(steamId);

  // 3. Call NextAuth signIn — this sets the session cookie and redirects.
  try {
    await signIn("steam", { token, redirect: true, redirectTo: "/" });
    // signIn(redirect:true) throws a redirect, so we shouldn't reach here.
    return NextResponse.redirect(new URL("/", url.origin));
  } catch (e) {
    // NextAuth uses thrown redirects in v5; let them propagate.
    if ((e as { digest?: string })?.digest?.startsWith?.("NEXT_REDIRECT")) {
      throw e;
    }
    console.error("[steam-callback] signIn failed", e);
    return NextResponse.redirect(new URL("/auth/signin?error=steam_signin_failed", url.origin));
  }
}
