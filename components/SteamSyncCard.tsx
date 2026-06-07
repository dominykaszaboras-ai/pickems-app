"use client";
// Lets the signed-in (via Steam) user paste their Major Auth Code and pull
// their Valve picks. Posts to /api/pickems/sync-steam and renders whatever
// Steam returned — useful as a debug surface while the mapping is dialled in.

import { useState } from "react";
import clsx from "clsx";

const STEAM_HELP_URL =
  "https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=730&issueid=128";

export function SteamSyncCard() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    error?: string;
    predictionsCount?: number;
    note?: string;
    eventId?: number;
  } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch("/api/pickems/sync-steam", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ steamPickemCode: code.trim() }),
      });
      const data = await r.json().catch(() => ({}));
      setResult(r.ok ? { ok: true, ...data } : { ok: false, error: data?.error });
    } catch (err) {
      setResult({ ok: false, error: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-panel p-5">
      <h2 className="mb-1 text-lg font-semibold">Sync from Steam</h2>
      <p className="mb-4 text-sm text-muted">
        Paste your <strong>Major Auth Code</strong> from Steam to import the picks
        you submitted in-game / on counter-strike.net. The code is a one-time
        identifier Valve issues per Major.
      </p>

      <a
        href={STEAM_HELP_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mb-4 inline-block rounded-md bg-[#171a21] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1f2530]"
      >
        Get your Major Auth Code from Steam ↗
      </a>

      <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="AAAA-AAAAA-AAAA"
          className="flex-1 rounded-lg border border-line bg-panel2 px-3 py-2 font-mono text-sm uppercase tracking-wider"
        />
        <button
          disabled={busy || !code.trim()}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-ink disabled:opacity-60"
        >
          {busy ? "Syncing…" : "Sync from Steam"}
        </button>
      </form>

      {result && (
        <div
          className={clsx(
            "mt-4 rounded-lg border p-3 text-sm",
            result.ok ? "border-win/40 bg-win/10" : "border-loss/40 bg-loss/10",
          )}
        >
          {result.ok ? (
            <>
              <div>
                ✓ Pulled {result.predictionsCount ?? 0} prediction(s) for event{" "}
                <span className="font-mono">{result.eventId}</span>.
              </div>
              {result.note && <div className="mt-1 text-xs text-muted">{result.note}</div>}
            </>
          ) : (
            <div>✗ {result.error ?? "Sync failed"}</div>
          )}
        </div>
      )}
    </section>
  );
}
