// Tiny presentational badge that renders the user's current medal next to
// their score. Decoupled from the scoring engine — feed it the integer
// correct-pick count and it figures out which tier to show.

import { getMedal, MEDAL_INFO, type Medal } from "@/lib/medals";

export function MedalBadge({
  correct,
  size = "md",
  showLabel = false,
}: {
  correct: number;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}) {
  const tier: Medal = getMedal(correct);
  const info = MEDAL_INFO[tier];
  const sizeClass =
    size === "lg" ? "text-3xl" : size === "sm" ? "text-base" : "text-xl";
  return (
    <span
      title={`${info.label} — ${info.range}`}
      className={`inline-flex items-center gap-1 ${info.accent}`}
    >
      <span className={sizeClass} aria-hidden>
        {info.emoji}
      </span>
      {showLabel && (
        <span className="text-xs font-medium uppercase tracking-wide">
          {info.label}
        </span>
      )}
    </span>
  );
}
