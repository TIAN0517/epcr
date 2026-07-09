/**
 * GET /api/emic/session
 * Returns { authed: boolean } based on the `emic_sid` cookie.
 */
import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/emic/auth";
import type { SessionResponse } from "@/lib/emic/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const res: SessionResponse = { authed: await isAuthed() };
  return NextResponse.json(res, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
