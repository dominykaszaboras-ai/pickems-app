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

// POST UploadTournamentPredictions/v1.
//
// Format is undocumented; reverse-engineered against the upload your Steam
// account already sent (so re-uploading the same picks is a safe no-op /
// idempotent confirmation). Body shape we ship:
//
//   POST .../UploadTournamentPredictions/v1/
//   Content-Type: application/x-www-form-urlencoded
//   key=...
//   event=26
//   steamid=765...
//   steamidkey=AAAA-AAAAA-AAAA
//   predictions=[{"groupid":271,"index":0,"pick":80}, ...]
//
// If Valve rejects this shape we'll see a 4xx with a hint and iterate.
// The function returns Valve's parsed JSON response so the caller can
// inspect `result.success` / `result.error` if present.
export async function uploadTournamentPredictions(
  event: number,
  steamId: string,
  steamidkey: string,
  picks: Array<{
    sectionid: number;
    groupid: number;
    index: number;
    pick: number;
    // The user's specific 20-digit inventory item id for the team sticker
    // being placed in this slot. Kept as a string to preserve precision.
    itemid: string;
  }>,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  if (picks.length === 0) {
    return { ok: true, status: 200, body: { skipped: true } };
  }
  const budgetOk = consumeOutboundBudget();
  if (!budgetOk.ok) {
    throw new Error("Steam upstream is throttled — try again shortly.");
  }

  // Format Valve actually expects (per probe response): repeated top-level
  // form fields. One sectionid/groupid/index/pickid per pick, with matching
  // array positions. Field name for the team is `pickid` (singular) here,
  // not `pick`, even though GetTournamentPredictions returns it as `pick`.
  // We send both shapes (pickid AND pick) to be tolerant of either reading.
  const form = new URLSearchParams();
  form.set("key", key());
  form.set("event", String(event));
  form.set("steamid", steamId);
  form.set("steamidkey", steamidkey);
  for (const p of picks) {
    form.append("sectionid", String(p.sectionid));
    form.append("groupid", String(p.groupid));
    form.append("index", String(p.index));
    form.append("pickid", String(p.pick));
    // itemid is the user's PERSONAL inventory item id for this team's
    // sticker — looked up via GetTournamentItems and threaded through
    // localPicksToSteam. Sending the wrong itemid causes 412 Precondition
    // Failed even when everything else is right.
    form.append("itemid", p.itemid);
  }

  let r: Response;
  try {
    r = await fetch(`${BASE}/UploadTournamentPredictions/v1/`, {
      method: "POST",
      headers: {
        "user-agent": "pickems-app",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
  } catch {
    throw new Error("Couldn't reach Steam (network).");
  }
  const text = await safeBody(r);
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  if (!r.ok) {
    console.error(
      `[steamPickems] upload ${r.status}: ${typeof parsed === "string" ? parsed : JSON.stringify(parsed).slice(0, 300)}`,
    );
  }
  return { ok: r.ok, status: r.status, body: parsed };
}

// GetTournamentItems/v1 — returns the user's owned Major sticker inventory
// items. Crucial for upload: Valve's `itemid` field is NOT the team's pickid;
// it's the user's UNIQUE 64-bit inventory item id for their copy of that
// team's sticker. Without the correct itemid, uploads return 412 Precondition
// Failed even when the picks themselves are valid.
//
// itemids are 20-digit numbers that overflow JavaScript's Number precision,
// so we extract them from the response body via regex and keep them as
// strings end-to-end (URLSearchParams accepts strings).
export async function getTournamentItems(
  event: number,
  steamId: string,
  steamidkey: string,
): Promise<Map<number, string>> {
  const budgetOk = consumeOutboundBudget();
  if (!budgetOk.ok) {
    throw new Error("Steam upstream is throttled — try again shortly.");
  }

  const u = new URL(`${BASE}/GetTournamentItems/v1/`);
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
    throw new Error(
      "Steam rejected your auth code while fetching team items.",
    );
  }
  if (!r.ok) {
    const body = await safeBody(r);
    console.error(`[steamPickems] items ${r.status}: ${body}`);
    throw new Error("Steam upstream error fetching your team items.");
  }

  // Don't JSON.parse — we'd lose precision on the 20-digit itemids. Walk
  // the raw text with a regex that captures both `teamid` and `itemid`
  // exactly as Valve emitted them.
  const text = await r.text();
  const out = new Map<number, string>();
  const re =
    /"type"\s*:\s*"team"[\s\S]*?"teamid"\s*:\s*(\d+)[\s\S]*?"itemid"\s*:\s*(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const teamid = Number(m[1]);
    const itemid = m[2];
    if (Number.isFinite(teamid) && itemid) out.set(teamid, itemid);
  }
  return out;
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

// Pull out the predictions array from whatever shape Valve returned.
//
// For IEM Cologne 2026 (confirmed against a real response) the shape is:
//   { result: { picks: [ { groupid, index, pick } ] } }
//
// Older Majors used `predictions` / `tournament_predictions`, and per-pick
// field names of `pickid` / `pick_id` / `teamid`. We check every variant we
// know of so we don't silently return 0.
//
// IMPORTANT: we keep zero-valued ids — Valve has used 0-based group indices
// in past majors and filtering on truthy would drop the first group silently.
export function extractPredictions(raw: unknown): SteamPickemPrediction[] {
  const r = raw as any;
  const candidates: any[] = [
    r?.result?.picks, // Cologne 2026
    r?.result?.predictions,
    r?.result?.tournament_predictions,
    r?.picks,
    r?.predictions,
    r?.tournament_predictions,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) {
      const out: SteamPickemPrediction[] = [];
      for (const p of c) {
        const groupid = numOrNull(p?.groupid ?? p?.group_id ?? p?.section);
        const index = numOrNull(p?.index ?? p?.idx) ?? 0;
        const pickid = numOrNull(
          p?.pick ?? p?.pickid ?? p?.pick_id ?? p?.teamid,
        );
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

// --- Layout slot map ---------------------------------------------------------
//
// Turn a GetTournamentLayout response into structures the mapper needs:
//   - byPickid: Steam team id (`pickid` from layout.teams) -> team name
//   - bySlot:   `${groupid}:${index}` -> { stageKind, slotKind, round? }
//
// Section names we observed for event 26 (Cologne 2026):
//   "Stage I | 1", "Stage II | 2", "Stage III | 3",
//   "Quarterfinals | 4", "Semifinals | 5", "Grand Final | 6"
// We match by substring so future Majors with the same naming convention
// work without code changes.
//
// Swiss index ordering (confirmed empirically against a real predictions
// response on 2026-06-16):
//   [0, 1]      -> SWISS_3_0
//   [2, 3, 4, 5, 6, 7] -> SWISS_ADVANCE
//   [8, 9]      -> SWISS_0_3

import type { PickKind, StageKind } from "./types";

export interface SteamLayoutParsed {
  byPickid: Map<number, string>;
  bySlot: Map<
    string,
    {
      stageKind: StageKind;
      pickKind: PickKind;
      round: number | null;
      sectionid: number;
      groupid: number;
      index: number;
    }
  >;
}

export function parseSteamLayout(layout: unknown): SteamLayoutParsed {
  const r = (layout as any)?.result ?? layout ?? {};
  const byPickid = new Map<number, string>();
  for (const t of (r.teams ?? []) as Array<{ pickid?: number; name?: string }>) {
    if (t.pickid != null && typeof t.name === "string" && t.name) {
      byPickid.set(Number(t.pickid), t.name);
    }
  }

  const bySlot: SteamLayoutParsed["bySlot"] = new Map();

  for (const s of (r.sections ?? []) as Array<{
    sectionid?: number;
    name?: string;
    groups?: Array<{ groupid?: number; picks?: Array<{ index?: number }> }>;
  }>) {
    const sName = String(s.name ?? "");
    const sectionid = Number(s.sectionid);
    if (!Number.isFinite(sectionid)) continue;
    const stage = detectStage(sName);
    if (!stage) continue;

    for (const g of s.groups ?? []) {
      const groupid = Number(g.groupid);
      if (!Number.isFinite(groupid)) continue;
      const picks = g.picks ?? [];
      for (const p of picks) {
        const idx = Number(p.index ?? 0);
        let pickKind: PickKind;
        const round: number | null = stage.round ?? null;
        if (stage.kind === "PLAYOFFS") {
          pickKind = "PLAYOFF_WINNER";
        } else if (idx <= 1) {
          pickKind = "SWISS_3_0";
        } else if (idx >= 8) {
          pickKind = "SWISS_0_3";
        } else {
          pickKind = "SWISS_ADVANCE";
        }
        bySlot.set(`${groupid}:${idx}`, {
          stageKind: stage.kind,
          pickKind,
          round,
          sectionid,
          groupid,
          index: idx,
        });
      }
    }
  }

  return { byPickid, bySlot };
}

function detectStage(
  name: string,
): { kind: StageKind; round?: number } | null {
  const n = name.toLowerCase();
  // Order matters: check long-form before short-form to avoid "Stage I" eating "Stage III".
  if (/stage\s*iii\b|stage\s*3\b/.test(n)) return { kind: "STAGE_3" };
  if (/stage\s*ii\b|stage\s*2\b/.test(n)) return { kind: "STAGE_2" };
  if (/stage\s*i\b|stage\s*1\b/.test(n)) return { kind: "STAGE_1" };
  if (/quarterfinal/.test(n)) return { kind: "PLAYOFFS", round: 1 };
  if (/semifinal/.test(n)) return { kind: "PLAYOFFS", round: 2 };
  if (/grand\s*final|grandfinal|^final\b/.test(n)) return { kind: "PLAYOFFS", round: 4 };
  return null;
}

// Convert a parsed layout + predictions list into our PickemPick shape.
// `teamIdByNormalizedName` is a precomputed lookup so callers can avoid a
// DB call per pick — pass `new Map(teams.map(t => [normalizeTeamName(t.name), t.id]))`.
//
// Unknown teams / unknown slots are skipped silently (logged) — better to
// import 28 out of 30 picks than to fail the whole sync because Valve added
// a team we haven't synced yet.
//
// Grand-Final treatment: Valve stores one Final pick (= the champion). Our
// schema separates round=3 (Final match winner) from round=4 (Champion). We
// emit BOTH rows pointing at the same team so both display + scoring lights up.
export function steamPicksToLocal(
  parsed: SteamLayoutParsed,
  picks: SteamPickemPrediction[],
  teamIdByNormalizedName: Map<string, string>,
  normalize: (name: string) => string,
): Array<{
  kind: PickKind;
  stageKind: StageKind;
  teamId: string;
  round: number | null;
}> {
  const out: Array<{
    kind: PickKind;
    stageKind: StageKind;
    teamId: string;
    round: number | null;
  }> = [];
  let unmatchedTeams = 0;
  let unmatchedSlots = 0;
  for (const p of picks) {
    const slot = parsed.bySlot.get(`${p.groupid}:${p.index}`);
    if (!slot) {
      unmatchedSlots++;
      continue;
    }
    const steamName = parsed.byPickid.get(p.pickid);
    if (!steamName) {
      unmatchedTeams++;
      continue;
    }
    const teamId = teamIdByNormalizedName.get(normalize(steamName));
    if (!teamId) {
      unmatchedTeams++;
      console.warn(`[steamPickems] no local team for Steam name "${steamName}"`);
      continue;
    }
    out.push({
      kind: slot.pickKind,
      stageKind: slot.stageKind,
      teamId,
      round: slot.round,
    });
    // Champion row mirrors Grand-Final pick.
    if (slot.stageKind === "PLAYOFFS" && slot.round === 4) {
      out.push({
        kind: slot.pickKind,
        stageKind: slot.stageKind,
        teamId,
        round: 3, // Final match winner = same team
      });
    }
  }
  if (unmatchedTeams || unmatchedSlots) {
    console.warn(
      `[steamPickems] mapper skipped ${unmatchedSlots} unknown slot(s) and ${unmatchedTeams} unknown team(s)`,
    );
  }
  return out;
}

// Reverse of steamPicksToLocal: our PickemPick rows -> Valve's upload shape.
//
// Round=4 (Champion) is intentionally NOT included as an extra pick — Valve's
// Grand Final group already represents the champion (one pick = the winner
// of the final). Sending round=4 too would either error or create a phantom
// pick. We rely on round=3 for the Final / Champion slot.
//
// Slot resolution for Swiss stages uses the SAME index convention as the
// read mapper:
//   3-0      -> [0, 1]
//   advance  -> [2, 3, 4, 5, 6, 7]
//   0-3      -> [8, 9]
// We allocate the available slots in order so two 3-0 picks land at indices
// 0 and 1 etc. — Valve doesn't care which 3-0 is "first" as long as both
// are in the 3-0 slots.
//
// Playoff QF picks are placed into the 4 QF groups in order. Order doesn't
// matter for scoring (you either picked the right team or you didn't); we
// just need to fill 4 groups with 4 teams.
export function localPicksToSteam(
  parsed: SteamLayoutParsed,
  localPicks: Array<{
    kind: PickKind;
    stageKind: StageKind;
    teamId: string;
    round: number | null;
  }>,
  teamNameById: Map<string, string>, // our team id -> name
  normalize: (name: string) => string,
  // Per-user inventory: teamid (Steam pickid) -> sticker itemid string.
  // Required for Valve to accept the upload. Build from getTournamentItems().
  itemidByTeamid: Map<number, string>,
): Array<{
  sectionid: number;
  groupid: number;
  index: number;
  pick: number;
  itemid: string;
}> {
  // Invert byPickid (Steam pickid -> name) to (normalized name -> Steam pickid).
  const steamPickidByNormalizedName = new Map<string, number>();
  for (const [pickid, name] of parsed.byPickid) {
    steamPickidByNormalizedName.set(normalize(name), pickid);
  }

  // Build group inventory: for each stageKind+slotKind, list available
  // (sectionid, groupid, index) tuples in order. We'll consume from these
  // as we map picks.
  type SlotKey = `${StageKind}:${string}`;
  const inventory = new Map<
    SlotKey,
    Array<{ sectionid: number; groupid: number; index: number; round: number | null }>
  >();
  for (const v of parsed.bySlot.values()) {
    const key: SlotKey = `${v.stageKind}:${v.pickKind}`;
    const list = inventory.get(key) ?? [];
    list.push({
      sectionid: v.sectionid,
      groupid: v.groupid,
      index: v.index,
      round: v.round,
    });
    inventory.set(key, list);
  }
  for (const list of inventory.values()) {
    list.sort((a, b) => a.groupid - b.groupid || a.index - b.index);
  }

  const out: Array<{
    sectionid: number;
    groupid: number;
    index: number;
    pick: number;
    itemid: string;
  }> = [];

  for (const local of localPicks) {
    // Champion (round=4) is folded into round=3 on Steam's side.
    if (local.round === 4) continue;

    const teamName = teamNameById.get(local.teamId);
    if (!teamName) continue;
    const steamPickid = steamPickidByNormalizedName.get(normalize(teamName));
    if (steamPickid == null) continue;

    const key: SlotKey = `${local.stageKind}:${local.kind}`;
    const slots = inventory.get(key);
    if (!slots || slots.length === 0) continue;

    // For playoffs, match the slot by round if we have one; otherwise just
    // take the next available slot.
    let slotIdx = 0;
    if (local.kind === "PLAYOFF_WINNER" && local.round != null) {
      const r = local.round;
      slotIdx = slots.findIndex((s) => s.round === r);
      if (slotIdx < 0) slotIdx = 0;
    }
    const slot = slots.splice(slotIdx, 1)[0];

    // Skip picks where the user doesn't own the team sticker. We can't
    // upload them — Valve would reject with 412. Better to silently drop
    // than to fail the whole batch.
    const itemid = itemidByTeamid.get(steamPickid);
    if (!itemid) continue;

    out.push({
      sectionid: slot.sectionid,
      groupid: slot.groupid,
      index: slot.index,
      pick: steamPickid,
      itemid,
    });
  }

  return out;
}
