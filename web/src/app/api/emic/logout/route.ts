/**
 * GET /api/emic/logout
 * Clears the `emic_sid` cookie and returns { ok: true }.
 */
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/emic/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const res = NextResponse.json({ ok: true }, { status: 200 });
  res.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}
