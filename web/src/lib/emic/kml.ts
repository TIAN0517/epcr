/**
 * EMIC 災情 KML — server-only 資料載入
 *
 * 資料來源優先序：
 *   1. emic_kml_poll.py 寫入的 JSON（輪詢快取，不經 dashboard_data.json）
 *   2. 程序內記憶體快取 + 直接 fetch KML
 */
import { readFileSync, statSync } from "fs";
import type { EmicKmlCase, EmicKmlResponse } from "@/lib/emic/types";
import { parseEmicKml, sortEmicKmlCasesNewestFirst } from "@/lib/emic/kml-shared";

export const EMIC_KML_URL =
  process.env.EMIC_KML_URL || "https://gis2.emic.gov.tw/EMICData/378.kml";

const KML_JSON_PATH =
  process.env.EMIC_KML_JSON_PATH ||
  "/root/epcr_extracted/dashboard/emic_kml.json";

const CACHE_TTL_MS = Number(process.env.EMIC_KML_CACHE_SEC || "90") * 1000;
/** poll 檔超過此秒數未寫入才視為過期（預設 5 分鐘） */
const FILE_STALE_MS =
  Number(process.env.EMIC_KML_FILE_MAX_SEC || "300") * 1000;

let cache: { ts: number; cases: EmicKmlCase[]; fileMtime: number } | null =
  null;

function loadKmlFromPollFile(): {
  ts: number;
  cases: EmicKmlCase[];
  fileMtime: number;
} | null {
  try {
    const st = statSync(KML_JSON_PATH);
    if (cache?.fileMtime === st.mtimeMs) {
      return cache;
    }
    const raw = JSON.parse(readFileSync(KML_JSON_PATH, "utf8")) as {
      cases?: EmicKmlCase[];
      updatedAt?: string;
    };
    if (!Array.isArray(raw.cases) || raw.cases.length === 0) return null;
    const parsed = raw.updatedAt ? Date.parse(raw.updatedAt) : NaN;
    const ts = Number.isFinite(parsed) ? parsed : st.mtimeMs;
    return { ts, cases: raw.cases, fileMtime: st.mtimeMs };
  } catch {
    return null;
  }
}

function isPollFileStale(fileMtime: number): boolean {
  return Date.now() - fileMtime > FILE_STALE_MS;
}

async function fetchKmlXml(): Promise<string> {
  const res = await fetch(EMIC_KML_URL, {
    headers: { "User-Agent": "EMIC-Dashboard/1.0" },
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`KML HTTP ${res.status}`);
  return res.text();
}

async function refreshKmlCache(): Promise<void> {
  const now = Date.now();
  const fromFile = loadKmlFromPollFile();
  if (fromFile && !isPollFileStale(fromFile.fileMtime)) {
    cache = fromFile;
    return;
  }
  if (cache && now - cache.ts <= CACHE_TTL_MS) return;
  const xml = await fetchKmlXml();
  const cases = parseEmicKml(xml);
  cache = { ts: now, cases, fileMtime: 0 };
}

export async function getEmicKmlData(opts: {
  region?: "kaohsiung" | "ntpc" | "all";
  activeOnly?: boolean;
}): Promise<EmicKmlResponse> {
  await refreshKmlCache();
  if (!cache) throw new Error("emic kml cache empty");

  const region = opts.region ?? "kaohsiung";
  const all = cache.cases;
  let shown = all;
  if (region === "kaohsiung") shown = shown.filter((c) => c.isKaohsiung);
  else if (region === "ntpc") shown = shown.filter((c) => c.isNtpc);
  if (opts.activeOnly) shown = shown.filter((c) => c.isActive);

  const ntpc = all.filter((c) => c.isNtpc).length;
  const kaohsiung = all.filter((c) => c.isKaohsiung).length;
  const active = all.filter((c) => c.isActive).length;
  const ntpcActive = all.filter((c) => c.isNtpc && c.isActive).length;
  const kaohsiungActive = all.filter((c) => c.isKaohsiung && c.isActive).length;

  return {
    updatedAt: new Date(cache.ts).toISOString(),
    source: EMIC_KML_URL,
    filters: {
      region,
      activeOnly: !!opts.activeOnly,
    },
    summary: {
      total: all.length,
      ntpc,
      kaohsiung,
      active,
      ntpcActive,
      kaohsiungActive,
      shown: shown.length,
    },
    cases: sortEmicKmlCasesNewestFirst(shown),
  };
}