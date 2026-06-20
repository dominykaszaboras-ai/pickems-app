"use client";
import { useEffect, useState } from "react";
import { formatCountdown } from "@/lib/formatTime";

// Self-ticking countdown label. Updates every 30s when more than an hour
// away, every 1s when under a minute, every 10s otherwise. Pauses ticking
// while the tab is hidden so we're not wasting cycles when nobody's looking.

export function Countdown({
  iso,
  className,
}: {
  iso: string | null;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!iso) return;
    function pickInterval(): number {
      const diffSec = (new Date(iso!).getTime() - Date.now()) / 1000;
      if (diffSec <= 0) return 1000;
      if (diffSec < 60) return 1000;
      if (diffSec < 3600) return 10_000;
      return 30_000;
    }
    let id: ReturnType<typeof setInterval> | null = null;
    function start() {
      if (id) clearInterval(id);
      id = setInterval(() => setNow(Date.now()), pickInterval());
    }
    function onVis() {
      if (document.hidden) {
        if (id) {
          clearInterval(id);
          id = null;
        }
      } else {
        setNow(Date.now());
        start();
      }
    }
    start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      if (id) clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [iso]);

  if (!iso) return null;
  return <span className={className}>{formatCountdown(iso, now)}</span>;
}
