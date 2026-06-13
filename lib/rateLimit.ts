// Tiny in-memory rate limiter.
//
// Designed for the single-instance Railway service we run today. If the
// service is ever scaled to multiple replicas, this needs to move to
// Postgres (one row per `key`) or Redis. Re-evaluate at that point.
//
// Semantics:
//   - Fixed-window counters: each (key, window-bucket) tracks N hits.
//   - On each call, if the current bucket count is < limit, the call
//     succeeds and the count is incremented. Otherwise it fails.
//   - Buckets older than the window are lazily evicted.
//
// We deliberately do NOT return granular "retry after" timing — the
// goal is "make brute force impractical", not RFC 6585 compliance.

import { NextRequest } from "next/server";

interface Bucket {
  count: number;
  expiresAt: number;
}

const buckets = new Map<string, Bucket>();

// Best-effort eviction so the map can't grow unbounded over months of uptime.
let lastSweepAt = 0;
function sweep(now: number) {
  if (now - lastSweepAt < 60_000) return; // at most once per minute
  lastSweepAt = now;
  for (const [k, b] of buckets) {
    if (b.expiresAt <= now) buckets.delete(k);
  }
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

export function rateLimit(opts: {
  key: string;
  limit: number;
  windowMs: number;
}): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(opts.key);
  if (!existing || existing.expiresAt <= now) {
    buckets.set(opts.key, { count: 1, expiresAt: now + opts.windowMs });
    return { ok: true, remaining: opts.limit - 1, retryAfterSec: 0 };
  }

  if (existing.count >= opts.limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((existing.expiresAt - now) / 1000)),
    };
  }

  existing.count++;
  return {
    ok: true,
    remaining: opts.limit - existing.count,
    retryAfterSec: 0,
  };
}

// Best-effort client IP. Railway / most reverse proxies set X-Forwarded-For
// to a comma-separated list with the original client first. Cloudflare-style
// `cf-connecting-ip` and Vercel-style `x-real-ip` are also honoured.
export function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

// Same-origin gate for state-changing requests. Returns true if the request
// looks like it came from our own front-end (Origin OR Referer matches the
// request's host). Returning false here should be treated as a 403.
//
// We honour AUTH_URL as the canonical app origin in addition to the request's
// host, so an `Origin: https://pickems-app-production.up.railway.app` is
// accepted even when the request URL was rewritten by Railway's edge.
export function isSameOrigin(req: NextRequest): boolean {
  const reqUrl = new URL(req.url);
  const allowedHosts = new Set<string>();
  allowedHosts.add(reqUrl.host);
  const authUrl = process.env.AUTH_URL;
  if (authUrl) {
    try {
      allowedHosts.add(new URL(authUrl).host);
    } catch {
      // Ignore malformed AUTH_URL.
    }
  }

  const origin = req.headers.get("origin");
  if (origin) {
    try {
      return allowedHosts.has(new URL(origin).host);
    } catch {
      return false;
    }
  }
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      return allowedHosts.has(new URL(referer).host);
    } catch {
      return false;
    }
  }
  // No Origin/Referer at all — most browsers send at least one on POST.
  // We err on the side of "reject" since this gate only runs on mutating
  // routes; legitimate same-origin POSTs will always carry one or the other.
  return false;
}
