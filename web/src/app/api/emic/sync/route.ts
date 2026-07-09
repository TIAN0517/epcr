/**
 * GET /api/emic/sync
 *
 * Requires the `emic_sid` cookie. Returns the full dashboard snapshot from
 * the stateful mock simulator. Each call advances the simulation so the
 * dashboard feels live when polled every 8 seconds.
 */
import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/emic/auth";
import { getSimulator } from "@/lib/emic/simulator";
import { loadLiveDashboard, liveDataAgeMs } from "@/lib/emic/live-data";
import { sanitizeDashboardData } from "@/lib/emic/stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  if (!(await isAuthed())) {
    return NextResponse.json(
      { authed: false, error: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }
  const age = liveDataAgeMs();
  const live = age !== null && age < 120_000 ? loadLiveDashboard() : null;
  const data = sanitizeDashboardData(live ?? getSimulator().snapshot());
  return NextResponse.json(data, {
    status: 200,
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate, private" },
  });
}
