// Small relative+absolute time formatter used by match cards and the
// schedule panel. Renders in the viewer's local timezone.

export function formatMatchTime(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso);
  const now = new Date();
  const diffMin = Math.round((t.getTime() - now.getTime()) / 60000);

  // Past — usually means HLTV hasn't flipped status to LIVE/FINISHED yet.
  if (diffMin < -60) return absoluteTime(t);
  if (diffMin < 0) return "starting now";

  if (diffMin < 60) return `in ${diffMin}m`;
  if (diffMin < 60 * 24 && t.getDate() === now.getDate()) {
    return `today ${hhmm(t)}`;
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (t.getDate() === tomorrow.getDate() && t.getMonth() === tomorrow.getMonth()) {
    return `tomorrow ${hhmm(t)}`;
  }
  return absoluteTime(t);
}

export function dayKey(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function hhmm(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function absoluteTime(d: Date): string {
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Short countdown formatter ("in 3s", "in 12m", "in 1h 23m", "in 2d 4h").
// Used by MatchCard to show when a PENDING match is about to start.
// `nowMs` is injectable so a single tick state can re-render multiple
// cards without each one calling Date.now() independently.
export function formatCountdown(iso: string | null, nowMs: number = Date.now()): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffSec = Math.floor((then - nowMs) / 1000);
  if (diffSec <= 0) return "starting now";
  if (diffSec < 60) return `in ${diffSec}s`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `in ${min}m`;
  const h = Math.floor(min / 60);
  const remMin = min % 60;
  if (h < 24) return remMin ? `in ${h}h ${remMin}m` : `in ${h}h`;
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH ? `in ${d}d ${remH}h` : `in ${d}d`;
}

// Short relative-past formatter ("3s ago", "12m ago", "2h ago", "5d ago").
// Used by the Sync button to show how long ago the last sync finished.
// `nowMs` is injectable so callers (clients with a tick state) can produce
// stable output across re-renders without relying on Date.now() inside.
export function formatAgo(iso: string | null, nowMs: number = Date.now()): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "never";
  const diffSec = Math.max(0, Math.floor((nowMs - then) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}
