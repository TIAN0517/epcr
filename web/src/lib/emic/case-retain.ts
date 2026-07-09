/** 案件保留 15 分鐘 — 倒數計時工具 */

export const CASE_RETAIN_SEC = 15 * 60;

export function caseKey(c: { uuid?: string; recordUuid?: string }): string {
  return c.uuid || c.recordUuid || "";
}

export function retainSecLeft(
  firstSeenAt?: string,
  fallback = CASE_RETAIN_SEC,
): number {
  if (!firstSeenAt) return fallback;
  const elapsed = (Date.now() - new Date(firstSeenAt).getTime()) / 1000;
  return Math.max(0, Math.floor(CASE_RETAIN_SEC - elapsed));
}

export function formatCountdown(totalSec: number): string {
  const m = Math.floor(totalSec / 60)
    .toString()
    .padStart(2, "0");
  const s = (totalSec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}