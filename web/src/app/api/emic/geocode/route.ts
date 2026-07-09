/**
 * GET /api/emic/geocode?lat=&lng=
 *
 * Requires the `emic_sid` cookie. Returns a *plausible* reverse-geocode
 * result for a New Taipei City location. Maps the lat/lng to the nearest
 * known fire branch HQ, then synthesizes a Taiwanese-style address.
 *
 * Module-level cache (max 500 entries, FIFO eviction) keyed by rounded
 * coordinates. A ~200-400ms artificial delay lets the UI show its
 * "查詢中…" state.
 */
import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/emic/auth";
import { emicFeatures } from "@/lib/emic/features";
import type { GeocodeResult } from "@/lib/emic/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface BranchGeo {
  name: string;
  district: string;
  lat: number;
  lng: number;
}

const NTC_BRANCHES: BranchGeo[] = [
  { name: "板橋", district: "板橋區", lat: 25.012, lng: 121.465 },
  { name: "三重", district: "三重區", lat: 25.061, lng: 121.488 },
  { name: "中和", district: "中和區", lat: 24.999, lng: 121.5 },
  { name: "永和", district: "永和區", lat: 25.014, lng: 121.514 },
  { name: "新莊", district: "新莊區", lat: 25.035, lng: 121.45 },
  { name: "土城", district: "土城區", lat: 24.974, lng: 121.47 },
  { name: "蘆洲", district: "蘆洲區", lat: 25.083, lng: 121.473 },
  { name: "樹林", district: "樹林區", lat: 24.991, lng: 121.424 },
  { name: "新店", district: "新店區", lat: 24.979, lng: 121.542 },
  { name: "淡水", district: "淡水區", lat: 25.168, lng: 121.44 },
  { name: "汐止", district: "汐止區", lat: 25.069, lng: 121.662 },
  { name: "林口", district: "林口區", lat: 25.078, lng: 121.378 },
  { name: "三峽", district: "三峽區", lat: 24.934, lng: 121.368 },
  { name: "鶯歌", district: "鶯歌區", lat: 24.956, lng: 121.339 },
];

const STREETS = [
  "文化路",
  "中山路",
  "民權路",
  "重慶路",
  "中正路",
  "三民路",
  "信義路",
  "和平路",
];

const VILLAGES = [
  "華德里",
  "福德里",
  "仁愛里",
  "中山里",
  "光復里",
  "民權里",
  "信義里",
  "八德里",
  "復興里",
  "自立里",
];

const CACHE_MAX = 500;
const geoCache = new Map<string, GeocodeResult>();

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function nearestBranch(lat: number, lng: number): BranchGeo {
  let best = NTC_BRANCHES[0];
  let bestD = Number.POSITIVE_INFINITY;
  for (const b of NTC_BRANCHES) {
    const d = haversineKm(lat, lng, b.lat, b.lng);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function reverseGeocode(lat: number, lng: number): GeocodeResult {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  const hit = geoCache.get(key);
  if (hit) return hit;

  const b = nearestBranch(lat, lng);
  const street = pick(STREETS);
  const section = randInt(1, 3);
  const house = randInt(1, 500);
  const sectionLabel = ["一", "二", "三"][section - 1];
  const village = pick(VILLAGES);

  const fullAddress = `新北市${b.district}${street}${sectionLabel}段${house}號`;
  const short = `${street}${sectionLabel}段${house}號`;
  const nlsc = `新北市${b.district}`;
  const nlscSect = `新北市${b.district}${village}`;

  const result: GeocodeResult = {
    fullAddress,
    display: fullAddress,
    short,
    nlsc,
    nlscSect,
    nlscDetail: null,
    lat,
    lng,
    source: "google",
    edtSource: "reverse",
    edtNote: "",
  };

  // FIFO eviction.
  if (geoCache.size >= CACHE_MAX) {
    const firstKey = geoCache.keys().next().value;
    if (firstKey) geoCache.delete(firstKey);
  }
  geoCache.set(key, result);
  return result;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!(await isAuthed())) {
    return NextResponse.json(
      { authed: false, error: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }
  if (!emicFeatures.geocode) {
    return NextResponse.json(
      { error: "geocode_disabled", message: "地址反查已暫停" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const url = new URL(req.url);
  const latRaw = url.searchParams.get("lat");
  const lngRaw = url.searchParams.get("lng");
  const lat = latRaw ? Number.parseFloat(latRaw) : Number.NaN;
  const lng = lngRaw ? Number.parseFloat(lngRaw) : Number.NaN;
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return NextResponse.json(
      { error: "missing or invalid lat/lng" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Artificial latency so the UI "查詢中…" state is visible.
  await delay(200 + Math.floor(Math.random() * 200));

  const result = reverseGeocode(lat, lng);
  return NextResponse.json(result, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
