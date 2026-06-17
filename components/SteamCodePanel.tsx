"use client";

// Profile-page version of the Major-Auth-Code form. Lets a Steam-linked
// user paste, refresh, or clear their per-Major Auth Code without first
// navigating to /pickems. Posts to the same /api/pickems/sync-steam
// endpoint that the SteamSyncCard uses — that route is the canonical
// "verify + store + apply" path.
//
// We never pre-fill the code into the input value; the existing UI on
// /pickems already established the "✓ Auth code on file (masked)" pattern.

import { useState } from "react";
import { useRouter } from "next/navigation";

const STEAM_HELP_URL =
  "https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=730&issueid=128";

type SubmitResult =
  | { ok: true; predictionsCount?: number; appliedCount?: number; note?: string }
  | { ok: false; error: string };

export function SteamCodePanel({
  hasCodeOnFile,
  lastSyncedAt,
}: {
  hasCodeOnFile: boolean;
  lastSyncedAt: string | null;
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);

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
      if (r.ok) {
        setResult({ ok: true, ...data });
        setCode("");
        router.refresh();
      } else {
        setResult({ ok: false, error: data?.error ?? `HTTP ${r.status}` });
      }
    } catch (err) {
      setResult({ ok: false, error: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-panel p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Major Auth Code</h2>
        <span className="text-xs text-muted">
          {hasCodeOnFile ? "On file" : "Not set"}
        </span>
      </div>
      <p className="mb-3 text-sm text-muted">
        Paste the per-Major code Valve issues you to grant us access to your
        Steam pickem predictions. We use it to pull your picks from Steam,
        and to mirror your webapp picks back so you still earn the Major
        sticker.
      </p>

      {hasCodeOnFile && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-700/40 bg-emerald-900/15 px-3 py-2 text-xs">
          <span className="text-emerald-200">
            ✓ Synced (<span className="font-mono">AAAA-•••••-AAAA</span>)
          </span>
          {lastSyncedAt && (
            <span className="text-muted">
              Last refresh: {new Date(lastSyncedAt).toLocaleString()}
            </span>
          )}
        </div>
      )}

      <a
        href={STEAM_HELP_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mb-3 inline-block rounded-md bg-[#171a21] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1f2530]"
      >
        Get your Major Auth Code from Steam ↗
      </a>

      <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="AAAA-AAAAA-AAAA"
          autoComplete="one-time-code"
          type="password"
          spellCheck={false}
          className="flex-1 rounded-lg border border-line bg-panel2 px-3 py-2 font-mono text-sm uppercase tracking-wider"
        />
        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-ink disabled:opacity-60"
        >
          {busy ? "Syncing…" : hasCodeOnFile ? "Update code" : "Save code"}
        </button>
      </form>

      {result && (
        <div
          className={`mt-3 rounded-lg border p-3 text-xs ${
            result.ok
              ? "border-emerald-700/40 bg-emerald-900/15 text-emerald-200"
              : "border-red-700/40 bg-red-900/15 text-red-200"
          }`}
        >
          {result.ok ? (
            <>
              ✓ Saved. Pulled {result.predictionsCount ?? 0} prediction(s) from Steam
              {typeof result.appliedCount === "number" && result.appliedCount > 0
                ? `; applied ${result.appliedCount} to your form`
                : ""}.
              {result.note && (
                <div className="mt-1 text-muted">{result.note}</div>
              )}
            </>
          ) : (
            <>✗ {result.error}</>
          )}
        </div>
      )}
    </div>
  );
}
