// POST /api/refresh
// Triggers the GitHub Actions "HLTV sync" workflow via the GitHub REST API.
// We dispatch through GH because HLTV's Cloudflare blocks Railway's IPs,
// but GitHub-hosted runners get through. The browser polls /api/last-sync
// to know when fresh data has landed in the DB.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { clientIp, isSameOrigin, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Repo coordinates — keep these in sync with .github/workflows/sync.yml
const REPO_OWNER = "dominykaszaboras-ai";
const REPO_NAME = "pickems-app";
const WORKFLOW_FILE = "sync.yml";
const BRANCH = "main";

// Coarse server-side throttle so a chatty client can't spam workflow
// dispatches. NOTE: this is per-process memory — fine for a single Railway
// instance, but if we ever scale to multiple replicas this needs a shared
// store (Postgres or Redis).
let lastDispatchAt = 0;
const MIN_INTERVAL_MS = 20_000;

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // Per-user throttle (in addition to the global one) so one chatty client
  // can't lock out everyone else by exhausting the global 20s window.
  const userId = (session.user as any).id as string | undefined;
  const userLimit = rateLimit({
    key: `refresh:user:${userId ?? clientIp(req)}`,
    limit: 6,
    windowMs: 60 * 1000, // 6 manual refreshes per user per minute
  });
  if (!userLimit.ok) {
    return NextResponse.json(
      { error: "Slow down — too many refreshes" },
      { status: 429, headers: { "retry-after": String(userLimit.retryAfterSec) } },
    );
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "GITHUB_TOKEN env var not configured on the server" },
      { status: 503 },
    );
  }

  const now = Date.now();
  if (now - lastDispatchAt < MIN_INTERVAL_MS) {
    return NextResponse.json(
      {
        error: "Already syncing — please wait a moment",
        retryAfterMs: MIN_INTERVAL_MS - (now - lastDispatchAt),
      },
      { status: 429 },
    );
  }
  lastDispatchAt = now;

  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "accept": "application/vnd.github+json",
      "authorization": `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
      "user-agent": "pickems-app",
    },
    body: JSON.stringify({ ref: BRANCH }),
  });

  if (!res.ok) {
    // Log the upstream detail for ourselves but DON'T leak it back to the
    // signed-in user — that detail can include the GitHub username or
    // repo path that owns the workflow.
    const text = await res.text().catch(() => "");
    console.error(`[refresh] GitHub dispatch failed: ${res.status} ${text.slice(0, 500)}`);
    // Reset the throttle so a real retry is possible after a failure.
    lastDispatchAt = 0;
    return NextResponse.json(
      { error: "Sync trigger failed — try again shortly" },
      { status: 502 },
    );
  }

  // GitHub returns 204 No Content on success.
  return NextResponse.json({ ok: true, dispatchedAt: new Date().toISOString() });
}
