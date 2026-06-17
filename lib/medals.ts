// Medal tier system. Each correct pick = 1 point; the medal you earn is a
// pure function of your total correct-pick count.
//
//   Bronze   1-5
//   Silver   6-15
//   Gold     16-25
//   Diamond  26+ (i.e. roughly two-thirds of the max 38 possible picks)
//
// Stages still in progress are counted only for picks that have already
// been decided (the scoring engine marks them `correct: true|false|null`).
// A "null" means the stage hasn't concluded yet so we don't credit nor
// penalise the pick.

export type Medal = "NONE" | "BRONZE" | "SILVER" | "GOLD" | "DIAMOND";

export interface MedalInfo {
  tier: Medal;
  label: string;
  emoji: string;
  // Tailwind colour class for accent borders / text on dark UI.
  accent: string;
  // Range copy for tooltips / legends.
  range: string;
}

export const MEDAL_INFO: Record<Medal, MedalInfo> = {
  NONE: {
    tier: "NONE",
    label: "No medal yet",
    emoji: "·",
    accent: "text-muted",
    range: "0 correct",
  },
  BRONZE: {
    tier: "BRONZE",
    label: "Bronze",
    emoji: "🥉",
    accent: "text-amber-600",
    range: "1–5 correct",
  },
  SILVER: {
    tier: "SILVER",
    label: "Silver",
    emoji: "🥈",
    accent: "text-slate-300",
    range: "6–15 correct",
  },
  GOLD: {
    tier: "GOLD",
    label: "Gold",
    emoji: "🥇",
    accent: "text-yellow-400",
    range: "16–25 correct",
  },
  DIAMOND: {
    tier: "DIAMOND",
    label: "Diamond Coin",
    emoji: "💎",
    accent: "text-cyan-300",
    range: "26+ correct",
  },
};

export function getMedal(correctCount: number): Medal {
  if (correctCount >= 26) return "DIAMOND";
  if (correctCount >= 16) return "GOLD";
  if (correctCount >= 6) return "SILVER";
  if (correctCount >= 1) return "BRONZE";
  return "NONE";
}
