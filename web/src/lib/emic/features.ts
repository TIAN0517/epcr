/**
 * 功能開關 — 設 0 / false / off 即關閉，改回 1 後 rebuild + restart 即可重開。
 * .env.production 與 /root/epcr_extracted/dashboard/emic_features.env 應保持同步。
 */
function enabled(...names: string[]): boolean {
  for (const name of names) {
    const v = process.env[name];
    if (v !== undefined) {
      return !["0", "false", "no", "off"].includes(v.toLowerCase());
    }
  }
  return false;
}

export const emicFeatures = {
  /** EMIC 災情 KML */
  kml: enabled("NEXT_PUBLIC_EMIC_FEATURE_KML", "EMIC_FEATURE_KML"),
  /** 救護車 GPS 案件自動反查記錄 */
  gpsCases: enabled(
    "NEXT_PUBLIC_EMIC_FEATURE_GPS_CASES",
    "EMIC_FEATURE_GPS_CASES",
  ),
  /** 地圖點選 / popup 座標反查 */
  geocode: enabled("NEXT_PUBLIC_EMIC_FEATURE_GEOCODE", "EMIC_FEATURE_GEOCODE"),
  /** E點通 KPI / 分隊統計 */
  edt: enabled("NEXT_PUBLIC_EMIC_FEATURE_EDT", "EMIC_FEATURE_EDT"),
} as const;

export type EmicFeatures = typeof emicFeatures;