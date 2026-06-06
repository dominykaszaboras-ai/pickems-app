// Step 1 of the Steam OpenID dance: bounce the browser to Steam.
//
// Steam will ask the user to authenticate (or use their existing Steam web
// session) and then redirect back to /api/auth/steam/callback with the
// signed openid.* params.

import { NextRequest, NextResponse } from "next/server";
import { buildRedirectUrl } from "@/lib/steam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function originOf(req: NextRequest): string {
  // Prefer the explicit AUTH_URL so we never accidentally use Railway's
  // private domain when behind a proxy.
  const fromEnv = process.env.AUTH_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  // Fall back to the incoming request URL.
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

export async function GET(req: NextRequest) {
  const origin = originOf(req);
  const returnTo = `${origin}/api/auth/steam/callback`;
  const realm = origin + "/"; // Steam requires trailing slash on realm
  return NextResponse.redirect(buildRedirectUrl(returnTo, realm));
}
