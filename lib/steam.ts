// Steam OpenID 2.0 + (optional) Steam Web API helpers.
//
// Steam's OpenID flow:
//  1. Redirect user to https://steamcommunity.com/openid/login with
//     openid.* params telling Steam where to return them.
//  2. Steam redirects back with openid.claimed_id including the
//     SteamID64 plus a signature.
//  3. We POST the same params back to Steam with
//     openid.mode=check_authentication. If Steam responds is_valid:true
//     we trust the claimed_id.
//
// This is OpenID 2.0 (deprecated standard) but Steam still uses it.

import { createHmac, timingSafeEqual } from "node:crypto";

const OPENID_ENDPOINT = "https://steamcommunity.com/openid/login";
const OPENID_NS = "http://specs.openid.net/auth/2.0";
const OPENID_IDENTIFIER = "http://specs.openid.net/auth/2.0/identifier_select";
const STEAMID_PATH_PREFIX = "https://steamcommunity.com/openid/id/";

export interface SteamProfile {
  steamId: string;
  name: string | null;
  avatar: string | null;
  profileUrl: string | null;
}

// --- Step 1: build the redirect URL ----------------------------------------
export function buildRedirectUrl(returnTo: string, realm: string): string {
  const p = new URLSearchParams({
    "openid.ns": OPENID_NS,
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo,
    "openid.realm": realm,
    "openid.identity": OPENID_IDENTIFIER,
    "openid.claimed_id": OPENID_IDENTIFIER,
  });
  return `${OPENID_ENDPOINT}?${p.toString()}`;
}

// --- Step 2: verify the callback by asking Steam to confirm ----------------
export async function verifyCallback(searchParams: URLSearchParams): Promise<string | null> {
  // Echo every openid.* param back to Steam, with mode swapped to
  // check_authentication. Steam responds either is_valid:true or :false.
  const body = new URLSearchParams();
  for (const [k, v] of searchParams.entries()) {
    if (k.startsWith("openid.")) body.append(k, v);
  }
  body.set("openid.mode", "check_authentication");

  const res = await fetch(OPENID_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) return null;
  const text = await res.text();
  // Parse "is_valid:true" out of the key:value response.
  const valid = /is_valid:\s*true/i.test(text);
  if (!valid) return null;

  const claimedId = searchParams.get("openid.claimed_id") ?? "";
  if (!claimedId.startsWith(STEAMID_PATH_PREFIX)) return null;
  const steamId = claimedId.slice(STEAMID_PATH_PREFIX.length);
  if (!/^\d{17}$/.test(steamId)) return null;
  return steamId;
}

// --- Step 3 (optional): fetch profile via Steam Web API --------------------
export async function fetchSteamProfile(steamId: string): Promise<SteamProfile | null> {
  const key = process.env.STEAM_API_KEY;
  if (!key) return { steamId, name: null, avatar: null, profileUrl: null };
  const url =
    `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/` +
    `?key=${key}&steamids=${steamId}`;
  try {
    const r = await fetch(url, { headers: { "user-agent": "pickems-app" } });
    if (!r.ok) return { steamId, name: null, avatar: null, profileUrl: null };
    const data = await r.json();
    const p = data?.response?.players?.[0];
    if (!p) return { steamId, name: null, avatar: null, profileUrl: null };
    return {
      steamId,
      name: p.personaname ?? null,
      avatar: p.avatarfull ?? p.avatarmedium ?? null,
      profileUrl: p.profileurl ?? null,
    };
  } catch {
    return { steamId, name: null, avatar: null, profileUrl: null };
  }
}

// --- HMAC helpers ---------------------------------------------------------
// The OpenID callback signs the verified steamId with AUTH_SECRET and hands
// the resulting token to the NextAuth `steam` credentials provider. This is
// the only way that provider should ever be invoked — anyone hitting it
// directly without a valid token gets rejected.
export function signSteamId(steamId: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET not set");
  const sig = createHmac("sha256", secret).update(steamId).digest("hex");
  return `${steamId}.${sig}`;
}

export function verifySignedSteamId(token: string): string | null {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  const [steamId, sig] = token.split(".");
  if (!steamId || !sig || !/^\d{17}$/.test(steamId)) return null;
  const expected = createHmac("sha256", secret).update(steamId).digest("hex");
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? steamId : null;
}
