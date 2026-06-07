// Read/write helpers for Valve's `ICSGOTournaments_730` Steam Web API.
//
// Authoritative endpoint list (from SteamDatabase/SteamTracking):
//   GetTournamentLayout/v1     (public)            — structure of an event
//   GetTournamentPredictions/v1 (key + auth code)  — user's pickem picks
//   GetTournamentFantasyLineup/v1 (key + auth code) — user's fantasy roster
//   GetTournamentItems/v1      (key + auth code)   — user's sticker capsule
//   UploadTournamentPredictions/v1   (POST, write) — submit picks
//   UploadTournamentFantasyLineup/v1 (POST, write) — submit fantasy
//
// We use the first two for the import flow. Writing back to Valve is out of
// scope for now (and would require a more careful schema mapping).
//
// `event` here is the **Valve** event id — NOT the HLTV event id. Valve has
// its own per-Major numbering (e.g. Antwerp 2022 = 15, Rio 2022 = 16, …).
// We expose STEAM_PICKEM_EVENT_ID env var so the operator can set the right
// number for the current Major.

const BASE = "https://api.steampowered.com/ICSGOTournaments_730";

export interface SteamPickemPrediction {
  // What Valve returns — opaque enough that we keep the raw JSON around too.
  groupid: number;
  index: number;
  pickid: number;
  itemid?: string | number;
}

export interface SteamLayoutSection {
  sectionid: number;
  name?: string;
  groups?: SteamLayoutGroup[];
}
export interface SteamLayoutGroup {
  groupid: number;
  name?: string;
  picks?: SteamLayoutPick[];
  // Some sections list "items" (teams) and a per-slot limit.
  picksperitem?: number;
}
export interface SteamLayoutPick {
  pickid: number;
  name?: string;
  // Some picks correspond to a specific team/item; the team id is sometimes
  // the same as `pickid` for swiss tournaments.
}

export async function getTournamentLayout(event: number): Promise<unknown> {
  // Layout is unauthenticated *per user*, but Steam still requires a valid
  // Web API key. Otherwise the request returns HTTP 403 Forbidden.
  const key = process.env.STEAM_API_KEY;
  if (!key) throw new Error("STEAM_API_KEY not configured on the server");
  const u = new URL(`${BASE}/GetTournamentLayout/v1/`);
  u.searchParams.set("key", key);
  u.searchParams.set("event", String(event));
  const r = await fetch(u.toString(), { headers: { "user-agent": "pickems-app" } });
  if (!r.ok) throw new Error(`GetTournamentLayout: ${r.status} ${await r.text()}`);
  return r.json();
}

export async function getTournamentPredictions(
  event: number,
  steamId: string,
  steamidkey: string,
): Promise<unknown> {
  const key = process.env.STEAM_API_KEY;
  if (!key) throw new Error("STEAM_API_KEY not configured on the server");
  const u = new URL(`${BASE}/GetTournamentPredictions/v1/`);
  u.searchParams.set("key", key);
  u.searchParams.set("event", String(event));
  u.searchParams.set("steamid", steamId);
  u.searchParams.set("steamidkey", steamidkey);
  const r = await fetch(u.toString(), { headers: { "user-agent": "pickems-app" } });
  if (r.status === 401 || r.status === 403) {
    throw new Error("Steam rejected the auth code (401/403) — code may be expired or wrong steamid");
  }
  if (!r.ok) throw new Error(`GetTournamentPredictions: ${r.status} ${await r.text()}`);
  return r.json();
}

// Pull out the predictions array from whatever shape Valve returned. Recent
// payloads have looked like { result: { predictions: [...] } } but the wiki
// has shown a few variants over majors, so we look in a few likely places.
export function extractPredictions(raw: unknown): SteamPickemPrediction[] {
  const r = raw as any;
  const candidates: any[] = [
    r?.result?.predictions,
    r?.result?.tournament_predictions,
    r?.predictions,
    r?.tournament_predictions,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) {
      return c
        .map((p: any) => ({
          groupid: Number(p.groupid ?? p.group_id ?? p.section ?? 0),
          index: Number(p.index ?? p.idx ?? 0),
          pickid: Number(p.pickid ?? p.pick_id ?? p.teamid ?? 0),
          itemid: p.itemid ?? p.item_id ?? undefined,
        }))
        .filter((p) => p.groupid && p.pickid);
    }
  }
  return [];
}
