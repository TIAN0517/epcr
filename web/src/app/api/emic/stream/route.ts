/**
 * GET /api/emic/stream?id=<recordUuid>
 *
 * Authenticated reverse proxy for live MSE streams.
 * The upstream VoIP URL never leaves the server.
 */
import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/emic/auth";
import { buildUpstreamStreamUrl } from "@/lib/emic/stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthed())) {
    return NextResponse.json(
      { authed: false, error: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  const id = new URL(req.url).searchParams.get("id")?.trim() ?? "";
  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json(
      { error: "invalid id" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const upstream = buildUpstreamStreamUrl(id);
  try {
    const upstreamRes = await fetch(upstream, {
      headers: {
        "User-Agent": "EMIC-Dashboard/1.0",
        Accept: "*/*",
      },
      cache: "no-store",
    });

    if (!upstreamRes.ok || !upstreamRes.body) {
      return NextResponse.json(
        { error: "stream unavailable" },
        { status: upstreamRes.status || 502, headers: { "Cache-Control": "no-store" } }
      );
    }

    const headers = new Headers();
    const ctype = upstreamRes.headers.get("content-type");
    if (ctype) headers.set("Content-Type", ctype);
    headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    headers.set("X-Content-Type-Options", "nosniff");

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers,
    });
  } catch {
    return NextResponse.json(
      { error: "stream fetch failed" },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}