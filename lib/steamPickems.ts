// Read helpers for Valve's `ICSGOTournaments_730` Steam Web API.
//
// Authoritative endpoint list (from SteamDatabase/SteamTracking):
//   GetTournamentLayout/v1     (key, public per-user) — structure of an event
//   GetTournamentPredictions/v1 (key + auth code)     — user's pickem picks
//
// The `key` query-string parameter is our shared STEAM_API_KEY. Treat
// errors from Valve as potentially containing that key (their templates
// have varied across years) and scrub before surfacing to anyone.
//
// `event` here is the **Valve** event id — NOT the HLTV event id. Valve has
// its own per-Major numbering, exposed via STEAM_PICKEM_EVENT_ID.

const BASE = "https://api.steampowered.com/ICSGOTournaments_730";

export interface SteamPickemPrediction {
  // What Valve returns — opaque enough that we keep the raw JSON around too.
  groupid: number;
  index: number;
  pickid: number;
  itemid?: string | number;
}

function key(): string {
  const k = process.env.STEAM_API_KEY;
  if (!k) throw new Error("STEAM_API_KEY not configured");
  return k;
}

// Replace any literal occurrence of the key in `text` with `***`. Used on
// anything that crosses the trust boundary back to the client / logs.
function scrubKey(text: string): string {
  const k = process.env.STEAM_API_KEY;
  if (!k) return text;
  return text.split(k).join("***");
}

async function safeBody(r: Response): Promise<string> {
  try {
    const t = (await r.text()).slice(0, 300);
    return scrubKey(t);
  } catch {
    return "";
  }
}

// --- Outbound budget ---------------------------------------------------------
//
// Our shared key has a 100k/day quota. The route-level rate limiter caps a
// single (user, IP) but not the aggregate, so we additionally cap aggregate
// outbound calls process-wide. Fixed windows; single-replica only (matches
// the rest of the app's in-memory limiter posture).

interface Window {
  count: number;
  expiresAt: number;
}

const budget = new Map<string, Window>();

function consumeOutboundBudget(): { ok: true } | { ok: false; reason: string } {
  const now = Date.now();
  const checks: Array<{ name: string; limit: number; windowMs: number }> = [
    { name: "steam-key-min", limit: 60, windowMs: 60_000 },
    { name: "steam-key-day", limit: 20_000, windowMs: 86_400_000 },
  ];
  // First pass: peek without incrementing so a failure on the day-bucket
  // doesn't consume a minute-bucket slot.
  for (const c of checks) {
    const w = budget.get(c.name);
    if (w && w.expiresAt > now && w.count >= c.limit) {
      return { ok: false, reason: c.name };
    }
  }
  // Second pass: increment all.
  for (const c of checks) {
    const w = budget.get(c.name);
    if (!w || w.expiresAt <= now) {
      budget.set(c.name, { count: 1, expiresAt: now + c.windowMs });
    } else {
      w.count++;
    }
  }
  return { ok: true };
}

// --- Layout cache ------------------------------------------------------------
//
// Layout is per-event, not per-user. Cache for an hour so repeated /sync
// requests don't double the outbound calls or duplicate the JSON inside
// every User.steamPickemRaw.

const layoutCache = new Map<number, { value: unknown; expiresAt: number }>();
const LAYOUT_TTL_MS = 60 * 60 * 1000;

export async function getTournamentLayout(event: number): Promise<unknown> {
  const cached = layoutCache.get(event);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;

  const budgetOk = consumeOutboundBudget();
  if (!budgetOk.ok) {
    throw new Error("Steam upstream is throttled — try again shortly.");
  }

  const u = new URL(`${BASE}/GetTournamentLayout/v1/`);
  u.searchParams.set("key", key());
  u.searchParams.set("event", String(event));
  let r: Response;
  try {
    r = await fetch(u.toString(), { headers: { "user-agent": "pickems-app" } });
  } catch {
    throw new Error("Couldn't reach Steam (network).");
  }
  if (!r.ok) {
    const body = await safeBody(r);
    console.error(`[steamPickems] layout ${r.status}: ${body}`);
    throw new Error("Steam upstream error fetching tournament layout.");
  }
  const value = await r.json();
  layoutCache.set(event, { value, expiresAt: now + LAYOUT_TTL_MS });
  return value;
}

export async function getTournamentPredictions(
  event: number,
  steamId: string,
  steamidkey: string,
): Promise<unknown> {
  const budgetOk = consumeOutboundBudget();
  if (!budgetOk.ok) {
    throw new Error("Steam upstream is throttled — try again shortly.");
  }

  const u = new URL(`${BASE}/GetTournamentPredictions/v1/`);
  u.searchParams.set("key", key());
  u.searchParams.set("event", String(event));
  u.searchParams.set("steamid", steamId);
  u.searchParams.set("steamidkey", steamidkey);
  let r: Response;
  try {
    r = await fetch(u.toString(), { headers: { "user-agent": "pickems-app" } });
  } catch {
    throw new Error("Couldn't reach Steam (network).");
  }
  if (r.status === 401 || r.status === 403) {
    // Don't surface Valve's body — it occasionally echoes the key.
    throw new Error(
      "Steam rejected your auth code. It may be expired, for a different SteamID, or for a different Major.",
    );
  }
  if (!r.ok) {
    const body = await safeBody(r);
    console.error(`[steamPickems] predictions ${r.status}: ${body}`);
    throw new Error("Steam upstream error fetching your predictions.");
  }
  return r.json();
}

// Pull out the predictions array from whatever shape Valve returned. Recent
// payloads have looked like { result: { predictions: [...] } } but the wiki
// has shown a few variants over majors, so we look in a few likely places.
//
// IMPORTANT: we keep zero-valued ids — Valve has used 0-based group indices
// in past majors and filtering on truthy would drop the first group silently.
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
      const out: SteamPickemPrediction[] = [];
      for (const p of c) {
        const groupid = numOrNull(p?.groupid ?? p?.group_id ?? p?.section);
        const index = numOrNull(p?.index ?? p?.idx) ?? 0;
        const pickid = numOrNull(p?.pickid ?? p?.pick_id ?? p?.teamid);
        if (groupid == null || pickid == null) continue;
        out.push({
          groupid,
          index,
          pickid,
          itemid: p?.itemid ?? p?.item_id ?? undefined,
        });
      }
      if (out.length === 0 && c.length > 0) {
        // Format drift — log so we notice next iteration without breaking.
        console.warn(
          `[steamPickems] extractPredictions got ${c.length} candidates but mapped 0; sample:`,
          JSON.stringify(c[0]).slice(0, 200),
        );
      }
      return out;
    }
  }
  return [];
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
