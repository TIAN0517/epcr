import { readFileSync, statSync } from "fs";
import type { DashboardData } from "@/lib/emic/types";

const DATA_PATH =
  process.env.EMIC_DATA_PATH ?? "/root/epcr_extracted/dashboard/dashboard_data.json";

/** Load the latest real-time snapshot written by Python monitor.py. */
export function loadLiveDashboard(): DashboardData | null {
  try {
    const raw = readFileSync(DATA_PATH, "utf8");
    return JSON.parse(raw) as DashboardData;
  } catch {
    return null;
  }
}

export function liveDataAgeMs(): number | null {
  try {
    return Date.now() - statSync(DATA_PATH).mtimeMs;
  } catch {
    return null;
  }
}