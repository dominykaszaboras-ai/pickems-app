// Step 2 of the Steam OpenID dance: verify Steam's response, HMAC-sign the
// SteamID, then hand it off to NextAuth's `steam` credentials provider to
// upsert the user and set the session cookie.

import { NextRequest, NextResponse } from "next/server";
import { signIn } from "@/lib/auth";
import { signSteamId, verifyCallback } from "@/lib/steam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Source of truth for our own URL. We do NOT trust req.url here because:
//   - some local-dev setups (system proxies, browser HSTS upgrades, reverse
//     proxies that rewrite the Host header) cause req.url to point at a
//     host:port we aren't actually serving on
//   - in those cases url.origin used for redirects becomes unreachable
// AUTH_URL is set explicitly in Railway / .env.local so it's always correct.
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

  // Use req.nextUrl for the query string (those params came from Steam and
  // can't be spoofed via Host rewrites) but use our trusted origin for any
  // URL we redirect to.
  const searchParams = req.nextUrl.searchParams;

  // 1. Ask Steam to confirm the response is genuine (mode=check_authentication).
  //    `host` is the host we expect openid.return_to to name — derived from
  //    AUTH_URL, not from the request, so it can't drift due to proxy rewrites.
  const steamId = await verifyCallback(searchParams, host);
  if (!steamId) {
    return NextResponse.redirect(`${origin}/auth/signin?error=steam_verify_failed`);
  }

  // 2. HMAC-sign the steamId with AUTH_SECRET so only this callback can hand
  //    it to the `steam` credentials provider.
  const token = signSteamId(steamId);

  // 3. Call NextAuth signIn — this sets the session cookie and redirects.
  try {
    await signIn("steam", { token, redirect: true, redirectTo: "/" });
    // signIn(redirect:true) throws a redirect, so we shouldn't reach here.
    return NextResponse.redirect(`${origin}/`);
  } catch (e) {
    // NextAuth uses thrown redirects in v5; let them propagate.
    if ((e as { digest?: string })?.digest?.startsWith?.("NEXT_REDIRECT")) {
      throw e;
    }
    console.error("[steam-callback] signIn failed", e);
    return NextResponse.redirect(`${origin}/auth/signin?error=steam_signin_failed`);
  }
}
