/**
 * EMIC 智慧雲端動態救護儀表板 — Backend ↔ Frontend data contract
 *
 * These types describe the exact shape returned by `GET /api/emic/sync`
 * (matching the original Python `dashboard_data.json` produced by monitor.py).
 * The frontend imports these directly to keep both sides in sync.
 *
 * All time fields are ISO-8601 strings (UTC, `...Z`).
 * All lat/lng are numbers (WGS-84).
 */

export type StatusId = 5 | 6 | 7 | 8;

export const STATUS_MAP: Record<StatusId, string> = {
  5: "已派遣",
  6: "已出發",
  7: "已到達",
  8: "執行中(有影像)",
};

export interface Filters {
  dispatchMaxMin: number;
  vitalsMaxMin: number;
  gpsLiveMin: number;
  gpsMaxMin: number;
  eventsMaxMin: number;
  imagesMaxMin: number;
}

/** A live dispatched ambulance unit (dispatch + GPS merged). */
export interface LiveUnit {
  uuid: string;
  statusId: StatusId;
  statusName: string;
  branch: string;
  ambulanceCode: string;
  licenseNo: string;
  dispatchedAt: string;
  departedAt: string | null;
  arrivedAt: string | null;
  ageMin: number;
  gpsLive: boolean;
  isStale: boolean;
  hasLiveVideo: boolean;
  lat: number;
  lng: number;
  gpsAgeMin: number;
  gpsUpdatedAt: string;
  epcrAddress: string | null;
  realAddress: string | null;
  caseId: string | null;
  /** 自動 GPS 反查現場地址（monitor 寫入） */
  gpsCaseAddress?: string | null;
  gpsCaseNlsc?: string | null;
  gpsCaseTrigger?: "arrived" | "on_scene" | "gps_stale" | null;
  gpsCaseRecordedAt?: string | null;
}

/** A live GPS point (subset of LiveUnit, with `isLive`). */
export interface GpsPoint {
  uuid: string;
  ambulanceCode: string;
  licenseNo: string;
  branch: string;
  statusId: StatusId;
  statusName: string;
  realAddress: string | null;
  lat: number;
  lng: number;
  gpsUpdatedAt: string;
  gpsAgeMin: number;
  dispatchedAt: string;
  dispAgeMin: number;
  isLive: boolean;
  isStale: boolean;
}

/** A recent vitals reading (one per active recordUuid). */
export interface Vitals {
  recordUuid: string;
  lastSeen: string;
  ageMin: number;
  hr: number | null;
  spo2: number | null;
  NBPm: number | null;
  NBPs: number | null;
  NBPd: number | null;
  respRate: number | null;
  temp: number | null;
  CaseID: string | null;
}

export interface DashboardEvent {
  EventType: string;
  Timestamp: string;
  recordUuid: string;
}

export interface DashboardImage {
  id: string;
  recordUuid: string;
  fileName: string;
  createdAt: string;
  download: string;
}

export interface StatusCounts {
  all: number;
  5: number;
  6: number;
  7: number;
  8: number;
}

export interface Summary {
  activeDispatches: number;
  liveVitals: number;
  gpsPoints: number;
  gpsLive: number;
  liveVideoCases: number;
  newCasesThisPoll: number;
  recentEvents: number;
  recentImages: number;
  totalAlerts: number;
  status5: number;
  status6: number;
  status7: number;
  status8: number;
  gpsCases?: number;
}

/** 救護車到達現場後自動反查並記錄的 GPS 案件 */
export interface GpsCase {
  uuid: string;
  ambulanceCode: string;
  licenseNo?: string;
  branch?: string;
  statusId: StatusId;
  statusName: string;
  caseId?: string | null;
  epcrAddress?: string | null;
  realAddress?: string | null;
  lat: number;
  lng: number;
  coordKey: string;
  gpsUpdatedAt?: string;
  gpsAgeMin?: number;
  dispatchedAt?: string;
  arrivedAt?: string | null;
  isStale: boolean;
  trigger: "arrived" | "on_scene" | "gps_stale";
  geocodedAddress: string | null;
  geocodeShort?: string | null;
  nlsc?: string | null;
  nlscSect?: string | null;
  geocodeSource?: string | null;
  geocodeError?: string | null;
  recordedAt: string;
  updatedAt: string;
  geocodedAt?: string | null;
  active?: boolean;
  closedAt?: string | null;
}

export type AlertType =
  | "new_case"
  | "new_vitals"
  | "status_change"
  | "live_video"
  | "gps_arrived"
  | "high_hr"
  | "low_spo2"
  | "emic_kml";

export interface Alert {
  type: AlertType;
  priority: 1 | 2;
  msg: string;
  data: LiveUnit | Vitals | GpsCase;
}

export interface NewCase extends Partial<LiveUnit> {
  caseType?: "dispatch" | "vitals";
  isNew?: boolean;
  /** 首次列入新案件清單的時間（ISO） */
  firstSeenAt?: string;
  /** 距離從清單移除的剩餘秒數 */
  retainSecLeft?: number;
  recordUuid?: string;
  lastSeen?: string;
  hr?: number | null;
  spo2?: number | null;
}

export interface EdtKpi {
  source: string;
  gpsNote: string;
  caseSampleSize: number | null;
  avgReactionTime: number | null;
  avgWorkTime: number | null;
  ambulanceSum: number;
  ambulanceWorking: number;
  vehicleUsagePct: number | null;
  branchSum: number;
  branchWorking: number;
  branchUsagePct: number | null;
  availability: number | null;
  prCarUseSum: number | null;
  prCarSum: number | null;
}

export interface EdtBranch {
  name: string;
  district: string;
  ambulanceSum: number;
  dispatchSum: number;
}

/** Original `branches` payload (raw-ish); we keep a slimmed version. */
export interface RawBranch {
  name: string;
  district: string;
  ambulanceSum: number;
  dispatchSum: number;
}

/** Top-level dashboard payload returned by `/api/emic/sync`. */
export interface DashboardData {
  updatedAt: string;
  tokenOk: boolean;
  pollInterval: number;
  filters: Filters;
  dataNote: string;
  summary: Summary;
  statusCounts: StatusCounts;
  edtKpi: EdtKpi;
  edtBranches: EdtBranch[];
  newCases: NewCase[];
  alerts: Alert[];
  dispatches: LiveUnit[];
  liveUnits: LiveUnit[];
  gps: GpsPoint[];
  gpsCases?: GpsCase[];
  gpsCasesRecent?: GpsCase[];
  vitals: Vitals[];
  liveVideo: LiveUnit[];
  images: DashboardImage[];
  events: DashboardEvent[];
  branches: RawBranch[];
}

/** ---------- Per-case detail (`/api/emic/case?id=<uuid>`) ---------- */

export interface CaseTrendingPoint {
  createdAt: string;
  hr: number | null;
  spo2: number | null;
  NBPm: number | null;
  NBPs: number | null;
  NBPd: number | null;
  respRate: number | null;
  temperature: number | null;
  recordUuid: string;
  CaseID: string | null;
}

export interface CaseEvent {
  EventType: string;
  Timestamp: string;
  recordUuid: string;
}

export interface CaseImage {
  id: string;
  fileName: string;
  url: string;
  createdAt: string;
}

export interface AiEcg {
  id: string;
  result: string;
  confidence: number;
  createdAt: string;
}

export interface CaseDetail {
  trendings: CaseTrendingPoint[];
  events: CaseEvent[];
  images: CaseImage[];
  aiEcg: AiEcg[];
  hasStream: boolean;
}

/** ---------- Reverse geocode (`/api/emic/geocode?lat=&lng=`) ---------- */

export interface GeocodeResult {
  fullAddress: string;
  display: string;
  short: string;
  nlsc: string;
  nlscSect: string;
  nlscDetail: unknown | null;
  lat: number;
  lng: number;
  source: "google";
  edtSource: "reverse";
  edtNote: "";
}

/** ---------- Auth ---------- */

export interface LoginResponse {
  ok: boolean;
  error?: string;
}

export interface SessionResponse {
  authed: boolean;
}

/** EMIC 災情通報 KML 單筆 */
export interface EmicKmlCase {
  id: string;
  name: string;
  lat: number;
  lng: number;
  style: string;
  icon: string | null;
  category: string;
  status: string;
  address: string;
  subCategory: string;
  reportTime: string;
  isNtpc: boolean;
  isKaohsiung: boolean;
  isActive: boolean;
}

export type EmicKmlRegion = "kaohsiung" | "ntpc" | "all";

export interface EmicKmlResponse {
  updatedAt: string;
  source: string;
  filters: { region: EmicKmlRegion; activeOnly: boolean };
  summary: {
    total: number;
    ntpc: number;
    kaohsiung: number;
    active: number;
    ntpcActive: number;
    kaohsiungActive: number;
    shown: number;
  };
  cases: EmicKmlCase[];
}
