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
