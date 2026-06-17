"use client";

// Lets a Steam-linked user paste their Major Auth Code and pull their Valve
// picks. We never pre-fill the value of the code — that would render it in
// page source for anyone with browser access. Instead, when the server says
// "we have one on file", we show a masked indicator and require the user
// to re-paste to re-sync.

import { useState } from "react";
import { formatAgo } from "@/lib/formatTime";

const STEAM_HELP_URL =
  "https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=730&issueid=128";

type SyncResult =
  | {
      ok: true;
      predictionsCount?: number;
      appliedCount?: number;
      stagesApplied?: string[];
      note?: string;
    }
  | { ok: false; error: string };

const STAGE_LABELS: Record<string, string> = {
  STAGE_1: "Stage 1",
  STAGE_2: "Stage 2",
  STAGE_3: "Stage 3",
  PLAYOFFS: "Playoffs",
};

export function SteamSyncCard({
  hasCodeOnFile,
  lastSyncedAt = null,
}: {
  hasCodeOnFile: boolean;
  lastSyncedAt?: string | null;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);

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
      setResult(
        r.ok
          ? { ok: true, ...data }
          : { ok: false, error: data?.error ?? `HTTP ${r.status}` },
      );
      if (r.ok) setCode(""); // clear the field on success
    } catch (err) {
      setResult({ ok: false, error: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-panel p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Auto-import from Steam</h2>
        <span className="text-[10px] uppercase tracking-wide text-muted">Optional</span>
      </div>
      <p className="mb-3 text-sm text-muted">
        Paste your <strong>Major Auth Code</strong> from Steam to import the picks
        you submitted in-game. The code is a per-Major identifier Valve issues
        you — it's not your password and doesn't grant us any other access.
      </p>

      {hasCodeOnFile && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-700/40 bg-emerald-900/15 px-3 py-2 text-xs">
          <span className="text-emerald-200">
            ✓ Synced — auth code on file
            (<span className="font-mono">AAAA-•••••-AAAA</span>)
          </span>
          {lastSyncedAt && (
            <span className="text-muted">
              Last refresh: {formatAgo(lastSyncedAt)}
            </span>
          )}
        </div>
      )}

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
          spellCheck={false}
          // one-time-code discourages most password managers + autofill from
          // remembering the value; type=password hides it visually.
          autoComplete="one-time-code"
          type="password"
          className="flex-1 rounded-lg border border-line bg-panel2 px-3 py-2 font-mono text-sm uppercase tracking-wider"
        />
        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-ink disabled:opacity-60"
        >
          {busy ? "Syncing…" : "Sync from Steam"}
        </button>
      </form>

      {result && (
        <div
          className={`mt-4 rounded-lg border p-3 text-sm ${
            result.ok
              ? "border-emerald-700/50 bg-emerald-900/20 text-emerald-200"
              : "border-red-700/50 bg-red-900/20 text-red-200"
          }`}
        >
          {result.ok ? (
            <>
              <div>
                ✓ Pulled {result.predictionsCount ?? 0} prediction(s) from Steam
                {typeof result.appliedCount === "number" &&
                result.appliedCount > 0 ? (
                  <>
                    {" "}— applied {result.appliedCount} to your form
                    {result.stagesApplied && result.stagesApplied.length > 0 ? (
                      <>
                        {" "}(
                        {result.stagesApplied
                          .map((s) => STAGE_LABELS[s] ?? s)
                          .join(", ")}
                        )
                      </>
                    ) : null}
                  </>
                ) : null}
                .
              </div>
              {result.note && (
                <div className="mt-1 text-xs text-muted">{result.note}</div>
              )}
            </>
          ) : (
            <div>✗ {result.error}</div>
          )}
        </div>
      )}
    </section>
  );
}
