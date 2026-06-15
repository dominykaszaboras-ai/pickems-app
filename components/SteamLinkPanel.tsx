"use client";

// Self-contained "Link Steam / Unlink Steam" UI shown on the viewer's own
// profile page. The link button is a plain anchor that kicks off the same
// OpenID dance as the regular Steam sign-in, but at a different endpoint
// (/api/auth/steam/link) so the callback knows to attach to the current
// user instead of creating a fresh Steam-only row.
//
// `hasFallback` tells us whether the user has email+passwordHash to fall
// back on; when false, the unlink button is greyed out with an explainer
// (the server-side route refuses that case anyway, but a UI hint is nicer
// than a 400 in DevTools).

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Props = {
  hasSteam: boolean;
  hasFallback: boolean;
};

const ERROR_LABELS: Record<string, string> = {
  steam_verify_failed: "Steam couldn't verify that login. Try again.",
  already_linked: "You already have a Steam account linked. Unlink it first to swap.",
  steam_taken: "That Steam account is already linked to a different user here.",
  link_failed: "Couldn't link your Steam account — please try again.",
  link_requires_signin: "Sign in first, then link your Steam account.",
  session_stale: "Your session expired. Sign in again to link Steam.",
};

const SUCCESS_LABELS: Record<string, string> = {
  "1": "Steam account linked.",
  already_yours: "That Steam account is already linked to you.",
};

export function SteamLinkPanel({ hasSteam, hasFallback }: Props) {
  const router = useRouter();
  const search = useSearchParams();
  const error = search?.get("error");
  const linked = search?.get("linked");

  const [pending, setPending] = useState(false);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);

  async function onUnlink() {
    if (!confirm("Unlink Steam from your account?")) return;
    setPending(true);
    setUnlinkError(null);
    try {
      const res = await fetch("/api/auth/steam/unlink", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setUnlinkError(
          body?.error === "no_fallback_credential"
            ? "Set an email + password first — otherwise you'd lock yourself out."
            : "Couldn't unlink right now. Try again.",
        );
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const errorMsg = error ? ERROR_LABELS[error] ?? null : null;
  const linkedMsg = linked ? SUCCESS_LABELS[linked] ?? null : null;

  return (
    <div className="rounded-2xl border border-line bg-panel p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Steam</h2>
        <span className="text-xs text-muted">
          {hasSteam ? "Linked" : "Not linked"}
        </span>
      </div>

      {errorMsg && (
        <div className="mb-3 rounded-lg border border-red-700/50 bg-red-900/20 px-3 py-2 text-xs text-red-300">
          {errorMsg}
        </div>
      )}
      {linkedMsg && (
        <div className="mb-3 rounded-lg border border-emerald-700/50 bg-emerald-900/20 px-3 py-2 text-xs text-emerald-300">
          {linkedMsg}
        </div>
      )}
      {unlinkError && (
        <div className="mb-3 rounded-lg border border-red-700/50 bg-red-900/20 px-3 py-2 text-xs text-red-300">
          {unlinkError}
        </div>
      )}

      {hasSteam ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onUnlink}
            disabled={pending || !hasFallback}
            className="rounded-lg border border-line bg-panel2 px-3 py-1.5 text-sm hover:bg-line disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Unlinking…" : "Unlink Steam"}
          </button>
          {!hasFallback && (
            <span className="text-xs text-muted">
              Set an email + password first so you don't get locked out.
            </span>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <a
            href="/api/auth/steam/link"
            className="inline-flex items-center gap-2 rounded-lg border border-line bg-panel2 px-3 py-1.5 text-sm hover:bg-line"
          >
            Link Steam account
          </a>
          <span className="text-xs text-muted">
            Pulls your Steam name + avatar. You can still sign in with email.
          </span>
        </div>
      )}
    </div>
  );
}
