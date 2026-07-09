import type { EmicKmlCase, EmicKmlRegion, EmicKmlResponse } from "@/lib/emic/types";

function decodeHtml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function emicField(desc: string, label: string): string {
  const re = new RegExp(
    `>\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*</td>\\s*<td[^>]*>\\s*([^<]+)`,
    "i",
  );
  const m = desc.match(re);
  return m ? decodeHtml(m[1].trim()) : "";
}

function parseStyles(xml: string): Record<string, string> {
  const styles: Record<string, string> = {};
  const re =
    /<Style[^>]*\sid="([^"]+)"[^>]*>[\s\S]*?<href>([^<]+)<\/href>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    styles[m[1].trim()] = m[2].trim();
  }
  return styles;
}

export function parseEmicKml(xml: string): EmicKmlCase[] {
  const styles = parseStyles(xml);
  const cases: EmicKmlCase[] = [];
  const blocks = xml.match(/<Placemark>[\s\S]*?<\/Placemark>/gi) || [];

  blocks.forEach((block, i) => {
    const coordM = block.match(
      /<coordinates>\s*([^<]+)\s*<\/coordinates>/i,
    );
    if (!coordM) return;
    const parts = coordM[1].trim().split(",");
    if (parts.length < 2) return;
    const lng = parseFloat(parts[0]);
    const lat = parseFloat(parts[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const nameM = block.match(/<name>([^<]*)<\/name>/i);
    const descM = block.match(/<description>([\s\S]*?)<\/description>/i);
    const styleM = block.match(/<styleUrl>\s*#?([^<]+)\s*<\/styleUrl>/i);

    const rawDesc = descM ? descM[1] : "";
    const desc = decodeHtml(rawDesc);
    const styleKey = styleM ? styleM[1].trim() : "";
    const category = emicField(desc, "主要類別") || (nameM?.[1] || "").trim();
    const status = emicField(desc, "案件狀態");
    const address = emicField(desc, "案件地點");

    cases.push({
      id: `${lat}|${lng}|${emicField(desc, "報案時間") || i}`,
      name: (nameM?.[1] || category || "災情").trim(),
      lat,
      lng,
      style: styleKey,
      icon: styles[styleKey] || null,
      category,
      status,
      address,
      subCategory: emicField(desc, "次要類別"),
      reportTime: emicField(desc, "報案時間"),
      isNtpc: address.includes("新北市"),
      isKaohsiung: address.includes("高雄市"),
      isActive: status === "處理中",
    });
  });

  return sortEmicKmlCasesNewestFirst(cases);
}

/** 解析 EMIC 報案時間字串為 epoch ms（支援 `YYYY-MM-DD HH:mm:ss`）。 */
export function parseEmicReportTimeMs(reportTime: string): number {
  const t = (reportTime || "").trim();
  if (!t || t.startsWith("2026-12-31")) return 0;
  const ms = Date.parse(t.includes("T") ? t : t.replace(" ", "T"));
  if (!Number.isFinite(ms)) return 0;
  if (ms > Date.now() + 7 * 86_400_000) return 0;
  return ms;
}

export function emicKmlRegionActive(
  kml: EmicKmlResponse | null,
  region: EmicKmlRegion,
): number {
  if (!kml) return 0;
  if (region === "kaohsiung") return kml.summary.kaohsiungActive ?? 0;
  if (region === "ntpc") return kml.summary.ntpcActive ?? 0;
  return kml.summary.active ?? kml.summary.shown ?? 0;
}

/** 最新案件在上、舊案在下（無效/哨兵時間排最底）。 */
export function sortEmicKmlCasesNewestFirst(cases: EmicKmlCase[]): EmicKmlCase[] {
  return [...cases].sort((a, b) => {
    const ta = parseEmicReportTimeMs(a.reportTime);
    const tb = parseEmicReportTimeMs(b.reportTime);
    if (ta === 0 && tb === 0) return 0;
    if (ta === 0) return 1;
    if (tb === 0) return -1;
    return tb - ta;
  });
}