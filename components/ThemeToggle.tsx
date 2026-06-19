"use client";
import { useEffect, useState } from "react";
import clsx from "clsx";

// Small icon-button that flips html.classList between `light` and `dark`,
// mirroring whatever the anti-FOUC script in `app/layout.tsx` initially set.
// Theme choice is persisted in localStorage so it survives reloads.
//
// On first render we read the current class off <html> rather than touching
// localStorage so the button label always matches what the user is actually
// seeing — the init script may have picked a different theme from
// `prefers-color-scheme` if no stored preference exists.

type Theme = "light" | "dark";

function currentTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("light") ? "light" : "dark";
}

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("dark");
  // Defer reading the real value until after mount to avoid hydration
  // mismatch (server has no DOM, every SSR render starts at "dark").
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(currentTheme());
    setMounted(true);
  }, []);

  function toggle() {
    const next: Theme = theme === "light" ? "dark" : "light";
    document.documentElement.classList.remove(theme);
    document.documentElement.classList.add(next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* private mode — fine, choice just won't persist */
    }
    setTheme(next);
  }

  // Render a placeholder until mounted so SSR + client agree on output.
  if (!mounted) {
    return (
      <button
        type="button"
        aria-label="Toggle theme"
        className={clsx(
          "inline-flex h-7 w-7 items-center justify-center rounded-full border border-line text-muted",
          className,
        )}
      />
    );
  }

  const isLight = theme === "light";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isLight ? "Switch to dark theme" : "Switch to light theme"}
      title={isLight ? "Switch to dark theme" : "Switch to light theme"}
      className={clsx(
        "inline-flex h-7 w-7 items-center justify-center rounded-full border border-line text-muted hover:bg-panel2 hover:text-text",
        className,
      )}
    >
      {isLight ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  );
}
