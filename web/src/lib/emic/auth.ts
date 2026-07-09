/**
 * EMIC dashboard auth helper — production-grade HMAC-signed sessions.
 *
 * Session id format:  `<base36-timestamp>.<hmac-sha256-hex>`
 *   - timestamp = Date.now() encoded in base36
 *   - hmac = HMAC-SHA256(timestamp, signKey) hex digest
 *
 * A session is "authed" iff the `emic_sid` cookie:
 *   1. splits into exactly two parts (`timestamp.hmac`)
 *   2. the HMAC recomputed over the timestamp matches the provided hmac
 *      (timing-safe comparison)
 *   3. the timestamp is within the last 7 days
 *
 * The signKey is a server-side secret that:
 *   - is taken from `process.env.EMIC_SIGN_KEY` if set, OR
 *   - is generated ONCE (32 random bytes → hex) and cached on
 *     `globalThis.__emicSignKey` so it survives Next.js dev HMR.
 * It is NEVER logged.
 *
 * Password verification:
 *   - Reads `DASHBOARD_PASSWORD` env var (required in production).
 *   - The input password is HMAC-SHA256 hashed with the signKey, then
 *     timing-safe compared with the hash of the env password.
 *
 * Note: Next.js 16 made `cookies()` (from `next/headers`) async (returns a
 * Promise), so `isAuthed()` is also async.
 */
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";

export const SESSION_COOKIE = "emic_sid";

/** Session lifetime: 7 days in milliseconds. */
const SESSION_TTL_MS = 60 * 60 * 24 * 7 * 1000;

interface GlobalWithEmicSignKey {
  __emicSignKey?: string;
}
const emicGlobal = globalThis as unknown as GlobalWithEmicSignKey;

/**
 * Resolve the server-side signing key ONCE per process.
 *
 * Priority:
 *   1. `process.env.EMIC_SIGN_KEY` (operator-provided, survives restarts)
 *   2. `globalThis.__emicSignKey` (cached across HMR in dev)
 *   3. freshly generated 32-byte hex (cached on globalThis)
 *
 * The key is NEVER logged.
 */
function resolveSignKey(): string {
  const envKey = process.env.EMIC_SIGN_KEY;
  if (envKey && envKey.length > 0) return envKey;
  if (emicGlobal.__emicSignKey) return emicGlobal.__emicSignKey;
  const generated = randomBytes(32).toString("hex");
  emicGlobal.__emicSignKey = generated;
  return generated;
}

/** Module-level singleton signKey (persists across requests in the process). */
const signKey: string = resolveSignKey();

/** Compute HMAC-SHA256(message, signKey) as a hex string. */
function hmacHex(message: string): string {
  return createHmac("sha256", signKey).update(message, "utf8").digest("hex");
}

/**
 * Timing-safe equality for two hex strings of equal length.
 * Returns false (without throwing) if the lengths differ.
 */
function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  try {
    const aBuf = Buffer.from(a, "hex");
    const bBuf = Buffer.from(b, "hex");
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

/** Generate a fresh signed session id: `<base36-timestamp>.<hmac-sha256-hex>`. */
export function makeSessionId(): string {
  const ts = Date.now().toString(36);
  const mac = hmacHex(ts);
  return `${ts}.${mac}`;
}

/**
 * Verify a signed session id.
 *
 * Returns true iff:
 *   - the value has the form `<ts>.<hmac>`
 *   - the HMAC recomputed over `ts` matches `hmac` (timing-safe)
 *   - the timestamp decodes to a number within the last 7 days
 *
 * Returns false (without throwing) on any malformed input.
 */
export function verifySessionId(sid: string): boolean {
  if (typeof sid !== "string" || sid.length === 0) return false;
  const dot = sid.indexOf(".");
  if (dot <= 0 || dot >= sid.length - 1) return false;
  const tsPart = sid.slice(0, dot);
  const macPart = sid.slice(dot + 1);

  let ts: number;
  try {
    ts = Number.parseInt(tsPart, 36);
  } catch {
    return false;
  }
  if (!Number.isFinite(ts) || ts <= 0) return false;

  // Timestamp freshness check (7-day window).
  const now = Date.now();
  if (ts > now + 60_000) return false; // allow 1 min clock skew into the future
  if (now - ts > SESSION_TTL_MS) return false;

  // Recompute and timing-safe compare.
  const expected = hmacHex(tsPart);
  return safeEqualHex(expected, macPart);
}

/**
 * Hash a password with the server signKey (HMAC-SHA256 → hex).
 *
 * HMAC-as-keyed-hash is acceptable for a single-user dashboard; no salt is
 * needed because the signKey is already secret server-side state.
 */
export function hashPassword(pwd: string): string {
  return hmacHex(pwd);
}

/**
 * Verify a candidate password against `DASHBOARD_PASSWORD`.
 * Timing-safe comparison of the HMAC hashes.
 */
export function verifyPassword(pwd: string): boolean {
  if (typeof pwd !== "string" || pwd.length === 0) return false;
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) return false;
  const candidateHash = hashPassword(pwd);
  return safeEqualHex(hashPassword(expected), candidateHash);
}

/**
 * Read the session cookie inside a Route Handler / Server Component.
 * Returns true iff the cookie is present and verifies as a valid signed
 * session id.
 *
 * MUST be awaited — `cookies()` is async in Next.js 16.
 */
export async function isAuthed(): Promise<boolean> {
  try {
    const jar = await cookies();
    const c = jar.get(SESSION_COOKIE);
    if (!c || !c.value) return false;
    return verifySessionId(c.value);
  } catch {
    return false;
  }
}

/**
 * Read the session cookie from a NextRequest (e.g. inside middleware-style
 * route handlers that receive the raw request). Synchronous.
 */
export function isAuthedRequest(req: NextRequest): boolean {
  try {
    const v = req.cookies.get(SESSION_COOKIE)?.value;
    if (!v) return false;
    return verifySessionId(v);
  } catch {
    return false;
  }
}
