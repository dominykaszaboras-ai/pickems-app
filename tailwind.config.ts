import type { Config } from "tailwindcss";

// All color tokens are backed by CSS variables so a single `.light` /
// `.dark` class on <html> swaps the entire palette. We use the
// `rgb(var(--c-x) / <alpha-value>)` form so Tailwind opacity modifiers
// (`bg-loss/15`, `text-muted/50`, etc.) continue to work.

function rgbVar(name: string): string {
  return `rgb(var(--c-${name}) / <alpha-value>)`;
}

const config: Config = {
  // We toggle by adding `.light` (instead of using `media`) so the user's
  // explicit choice always wins over the OS setting.
  darkMode: ["class", "html.light"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: rgbVar("ink"),
        panel: rgbVar("panel"),
        panel2: rgbVar("panel2"),
        line: rgbVar("line"),
        text: rgbVar("text"),
        muted: rgbVar("muted"),
        accent: rgbVar("accent"),
        win: rgbVar("win"),
        loss: rgbVar("loss"),
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
export default config;
