import "./globals.css";
import type { Metadata } from "next";
import { Providers } from "./providers";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "CS2 Major Pickems",
  description: "Predict CS2 Major outcomes, simulate the bracket, and track your pickems score in real time.",
};

// Runs before React hydrates so the correct theme class is on <html> on the
// very first paint — avoids a flash of dark theme for users who prefer light.
// Falls back to localStorage; otherwise honours the OS `prefers-color-scheme`.
const themeInitScript = `(function () {
  try {
    var stored = localStorage.getItem('theme');
    var theme = stored === 'light' || stored === 'dark'
      ? stored
      : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.classList.add(theme);
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="font-sans">
        <Providers>
          <Nav />
          {children}
        </Providers>
      </body>
    </html>
  );
}
