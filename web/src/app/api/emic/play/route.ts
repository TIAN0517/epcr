/**
 * GET /api/emic/play?id=<recordUuid>
 *
 * Returns a short-lived play ticket for browser-side MSE playback.
 * The upstream host is only disclosed in this authenticated JSON response
 * (never rendered in the page DOM). Browsers in TW can reach mer2voip;
 * the VPS origin cannot, so we must not proxy the stream server-side.
 */
import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/emic/auth";
import { buildUpstreamStreamUrl } from "@/lib/emic/stream";
import { loadLiveDashboard } from "@/lib/emic/live-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isLiveStreamId(id: string): boolean {
  const data = loadLiveDashboard();
  if (!data) return true;
  const inLive = (data.liveVideo ?? []).some((u) => u.uuid === id && u.hasLiveVideo);
  if (inLive) return true;
  const inDisp = (data.dispatches ?? []).some(
    (u) => u.uuid === id && u.hasLiveVideo && u.statusId === 8
  );
  return inDisp;
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!(await isAuthed())) {
    return NextResponse.json(
      { ok: false, authed: false, error: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  const id = new URL(req.url).searchParams.get("id")?.trim() ?? "";
  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json(
      { ok: false, error: "invalid id" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (!isLiveStreamId(id)) {
    return NextResponse.json(
      { ok: false, hasStream: false, error: "no live stream" },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      hasStream: true,
      /** Consumed by mpegts.js in the browser only — not shown in UI. */
      playUrl: buildUpstreamStreamUrl(id),
      expiresIn: 300,
    },
    { status: 200, headers: { "Cache-Control": "no-store, private" } }
  );
}