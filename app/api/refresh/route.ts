// POST /api/refresh
// Triggers the GitHub Actions "HLTV sync" workflow via the GitHub REST API.
// We dispatch through GH because HLTV's Cloudflare blocks Railway's IPs,
// but GitHub-hosted runners get through. The browser polls /api/last-sync
// to know when fresh data has landed in the DB.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Repo coordinates — keep these in sync with .github/workflows/sync.yml
const REPO_OWNER = "dominykaszaboras-ai";
const REPO_NAME = "pickems-app";
const WORKFLOW_FILE = "sync.yml";
const BRANCH = "main";

// Coarse server-side throttle so a chatty client can't spam workflow dispatches.
let lastDispatchAt = 0;
const MIN_INTERVAL_MS = 20_000;

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
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
    const text = await res.text().catch(() => "");
    // Reset the throttle so a real retry is possible after a failure.
    lastDispatchAt = 0;
    return NextResponse.json(
      { error: `GitHub dispatch failed: ${res.status} ${text.slice(0, 200)}` },
      { status: 502 },
    );
  }

  // GitHub returns 204 No Content on success.
  return NextResponse.json({ ok: true, dispatchedAt: new Date().toISOString() });
}
