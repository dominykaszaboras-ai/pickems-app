"use client";
// Tiny stacked-avatar badge that appears in the team row of a MatchCard
// when one or more of the viewer's friends picked that team. Hover/tap
// reveals the full list with names.
//
// Pick rules:
//   - For SWISS matches (no round): we surface any pick where the team
//     was tagged as 3-0 / 0-3 / advance — those all mean "called this
//     team's group result". Different kinds get different short labels.
//   - For PLAYOFF matches (round != null): only show picks whose round
//     matches the match's bracketRound. So a Champion pick doesn't
//     surface on a QF card.
//
// We render at most 3 avatars stacked, with a "+N" pill if more.

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useFriendsPicks, type FriendPick } from "./FriendsPicksProvider";

const KIND_LABEL: Record<string, string> = {
  SWISS_3_0: "3-0",
  SWISS_0_3: "0-3",
  SWISS_ADVANCE: "ADV",
  PLAYOFF_WINNER: "WIN",
};

export function FriendsPickedBadge({
  teamId,
  matchRound,
  matchIsSwiss,
}: {
  teamId: string;
  // The bracketRound for playoff matches. null for swiss.
  matchRound: number | null;
  matchIsSwiss: boolean;
}) {
  const { byTeam, friendById } = useFriendsPicks();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close popover on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const all = byTeam[teamId] ?? [];
  // Filter to picks that semantically apply to THIS match.
  const relevant = all.filter((p) => {
    if (matchIsSwiss) {
      return p.kind === "SWISS_3_0" || p.kind === "SWISS_0_3" || p.kind === "SWISS_ADVANCE";
    }
    return p.kind === "PLAYOFF_WINNER" && p.round === matchRound;
  });
  if (relevant.length === 0) return null;

  const sample = relevant.slice(0, 3);
  const extra = relevant.length - sample.length;

  return (
    <span ref={wrapRef as any} className="relative inline-flex">
      <span
        role="button"
        tabIndex={0}
        // Rendered as a span (not button) so it can sit safely INSIDE the
        // parent <button> that pickRow uses for click-to-simulate. We
        // re-implement the keyboard affordance manually.
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            setOpen((o) => !o);
          }
        }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        title={`${relevant.length} friend${relevant.length === 1 ? "" : "s"} picked this`}
        className="flex cursor-pointer items-center gap-0.5 rounded-full border border-line bg-panel2 px-1 py-0.5 hover:bg-panel2/80"
      >
        <span className="flex -space-x-1.5">
          {sample.map((p) => {
            const f = friendById.get(p.friendId);
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <span
                key={p.friendId}
                className="inline-block h-4 w-4 overflow-hidden rounded-full border border-panel2 bg-panel"
              >
                {f?.image ? (
                  <img src={f.image} alt={f.name ?? "friend"} className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-[7px] text-muted">
                    {(f?.name ?? "?").slice(0, 1).toUpperCase()}
                  </span>
                )}
              </span>
            );
          })}
        </span>
        {extra > 0 && (
          <span className="text-[9px] font-semibold text-muted">+{extra}</span>
        )}
      </span>
      {open && (
        <span
          role="tooltip"
          className={clsx(
            "absolute right-0 top-full z-30 mt-1 block min-w-[160px] rounded-lg border border-line bg-panel p-2 text-xs shadow-lg",
          )}
        >
          <span className="mb-1 block text-[10px] font-semibold uppercase text-muted">
            Friends picked
          </span>
          <span className="flex flex-col gap-1">
            {relevant.map((p) => {
              const f = friendById.get(p.friendId);
              return (
                <span key={p.friendId + p.kind + (p.round ?? "")} className="flex items-center gap-2">
                  <span className="inline-block h-5 w-5 overflow-hidden rounded-full border border-line bg-panel2">
                    {f?.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={f.image} alt={f.name ?? "friend"} className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-[9px] text-muted">
                        {(f?.name ?? "?").slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </span>
                  <span className="flex-1 truncate">{f?.name ?? "Friend"}</span>
                  <span className="rounded bg-panel2 px-1 text-[9px] font-semibold uppercase text-muted">
                    {pickLabel(p)}
                  </span>
                </span>
              );
            })}
          </span>
        </span>
      )}
    </span>
  );
}

function pickLabel(p: FriendPick): string {
  if (p.kind === "PLAYOFF_WINNER") {
    if (p.round === 4) return "CHAMP";
    if (p.round === 3) return "FINAL";
    if (p.round === 2) return "SF";
    return "QF";
  }
  return KIND_LABEL[p.kind] ?? "PICK";
}
