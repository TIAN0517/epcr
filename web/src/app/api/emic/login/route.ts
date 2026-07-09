/**
 * POST /api/emic/login
 * Body: { password: string }
 *
 * Verifies the password with `verifyPassword()` (HMAC-hashed, timing-safe
 * comparison against `DASHBOARD_PASSWORD` env var, default from env `DASHBOARD_PASSWORD`).
 *
 * Includes an in-memory rate limiter: max 8 attempts per 60 seconds per
 * client IP. On exceed, returns 429 with a Chinese error message.
 *
 * On success: sets httpOnly cookie `emic_sid` = signed session id,
 * SameSite=Lax, Secure in production, path=/, maxAge=7 days.
 */
import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  makeSessionId,
  verifyPassword,
} from "@/lib/emic/auth";
import type { LoginResponse } from "@/lib/emic/types";

// Always run on the Node.js runtime (stateful simulator lives in module scope).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

/** Rate-limit window (ms) and max attempts per window per IP. */
const RL_WINDOW_MS = 60_000;
const RL_MAX = 8;

interface RlEntry {
  count: number;
  first: number;
}
const rlMap = new Map<string, RlEntry>();

/** Extract client IP from request, falling back to "unknown". */
function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}

/**
 * Returns true if the IP is allowed to attempt now (under the limit),
 * false if rate-limited. Mutates the in-memory map.
 */
function rateLimitAllow(ip: string, now: number): boolean {
  // Evict stale entries to keep the map bounded.
  if (rlMap.size > 256) {
    for (const [k, v] of rlMap) {
      if (now - v.first > RL_WINDOW_MS) rlMap.delete(k);
    }
  }
  const entry = rlMap.get(ip);
  if (!entry) {
    rlMap.set(ip, { count: 1, first: now });
    return true;
  }
  if (now - entry.first > RL_WINDOW_MS) {
    // Window expired — reset.
    entry.count = 1;
    entry.first = now;
    return true;
  }
  entry.count += 1;
  return entry.count <= RL_MAX;
}

export async function POST(req: Request): Promise<NextResponse> {
  const ip = clientIp(req);
  const now = Date.now();

  if (!rateLimitAllow(ip, now)) {
    const res: LoginResponse = {
      ok: false,
      error: "登入嘗試過於頻繁，請稍後再試",
    };
    return NextResponse.json(res, {
      status: 429,
      headers: { "Cache-Control": "no-store" },
    });
  }

  let body: { password?: unknown } = {};
  try {
    body = (await req.json()) as { password?: unknown };
  } catch {
    body = {};
  }
  const pwd = typeof body.password === "string" ? body.password : "";

  if (!verifyPassword(pwd)) {
    const res: LoginResponse = { ok: false, error: "密碼錯誤" };
    return NextResponse.json(res, {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const sid = makeSessionId();
  const res: LoginResponse = { ok: true };
  const next = NextResponse.json(res, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
  next.cookies.set({
    name: SESSION_COOKIE,
    value: sid,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
  return next;
}
