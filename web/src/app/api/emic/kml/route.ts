/**
 * GET /api/emic/kml?region=kaohsiung&active=0
 * EMIC 災情通報 KML（需登入）
 */
import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/emic/auth";
import { emicFeatures } from "@/lib/emic/features";
import { getEmicKmlData } from "@/lib/emic/kml";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!emicFeatures.kml) {
    return NextResponse.json(
      {
        cases: [],
        summary: {
          shown: 0,
          ntpcActive: 0,
          kaohsiungActive: 0,
          total: 0,
          disabled: true,
        },
        disabled: true,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }

  const sp = req.nextUrl.searchParams;
  const explicit = (sp.get("region") || "").toLowerCase();
  let region: "kaohsiung" | "ntpc" | "all" = "kaohsiung";
  if (explicit === "kaohsiung" || explicit === "kh" || explicit === "高雄") {
    region = "kaohsiung";
  } else if (explicit === "ntpc" || explicit === "新北") {
    region = "ntpc";
  } else if (explicit === "all" || explicit === "0") {
    region = "all";
  } else if (sp.get("kaohsiung") === "1") {
    region = "kaohsiung";
  } else if (sp.get("ntpc") === "1") {
    region = "ntpc";
  }
  const activeOnly = sp.get("active") === "1";

  try {
    const data = await getEmicKmlData({ region, activeOnly });
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, private",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch failed";
    return NextResponse.json({ error: "emic kml fetch failed", detail: msg }, { status: 502 });
  }
}