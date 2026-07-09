/**
 * GET /api/emic/case?id=<uuid>
 *
 * Requires the `emic_sid` cookie. Returns aggregated case detail:
 * { trendings, events, images, aiEcg, streamUrl }.
 *
 * The uuid can be either a dispatchUuid (matches a LiveUnit.uuid) or a
 * recordUuid (matches a Vitals.recordUuid) — both resolve to the same case.
 */
import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/emic/auth";
import { getSimulator } from "@/lib/emic/simulator";
import { loadLiveDashboard } from "@/lib/emic/live-data";
import { sanitizeCaseDetail } from "@/lib/emic/stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  if (!(await isAuthed())) {
    return NextResponse.json(
      { authed: false, error: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }
  const url = new URL(req.url);
  const id = url.searchParams.get("id")?.trim() ?? "";
  if (!id) {
    return NextResponse.json(
      { error: "missing id" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
  const sim = getSimulator();
  let detail = sanitizeCaseDetail(sim.caseDetail(id));
  const live = loadLiveDashboard();
  if (live) {
    const hasStream =
      (live.liveVideo ?? []).some((u) => u.uuid === id && u.hasLiveVideo) ||
      (live.dispatches ?? []).some(
        (u) => u.uuid === id && u.hasLiveVideo && u.statusId === 8
      );
    detail = { ...detail, hasStream };
  }
  return NextResponse.json(detail, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
