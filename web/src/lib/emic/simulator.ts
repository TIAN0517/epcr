/**
 * EMIC Smart Cloud Ambulance Dashboard — stateful mock simulator.
 *
 * Pure mock — does NOT touch the real EPCR API (epcr.tpf.gov.tw).
 *
 * Singleton lives on `globalThis` so it survives HMR / across requests.
 * Each `snapshot()` call advances the simulation a small step:
 *   - vehicles move slightly (GPS jitter),
 *   - statuses transition (5→6→7→8 progression, finished cases reset),
 *   - new cases & alerts are injected,
 *   - vitals/events/images are appended.
 *
 * The frontend polls `/api/emic/sync` every 8s and observes a "live" feed.
 */
import { randomUUID } from "node:crypto";
import type {
  Alert,
  CaseDetail,
  CaseEvent,
  CaseImage,
  CaseTrendingPoint,
  AiEcg,
  DashboardData,
  DashboardEvent,
  DashboardImage,
  EdtBranch,
  EdtKpi,
  Filters,
  GpsPoint,
  LiveUnit,
  NewCase,
  RawBranch,
  StatusCounts,
  StatusId,
  Summary,
  Vitals,
} from "./types";
import { STATUS_MAP } from "./types";

/* ------------------------------------------------------------------ *
 * Static reference data — New Taipei City fire branches (分隊)
 * ------------------------------------------------------------------ */

interface BranchDef {
  name: string;
  district: string;
  lat: number;
  lng: number;
}

const BRANCHES: BranchDef[] = [
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

const EVENT_TYPES = [
  "到達現場",
  "上車",
  "送醫",
  "抵達醫院",
  "離開醫院",
  "心跳恢復",
];

/* ------------------------------------------------------------------ *
 * Internal mutable vehicle state
 * ------------------------------------------------------------------ */

interface VehicleState {
  branch: string;
  district: string;
  ambulanceCode: string;
  licenseNo: string;
  statusId: StatusId | null; // null = idle
  dispatchedAt: string | null;
  departedAt: string | null;
  arrivedAt: string | null;
  uuid: string | null; // dispatchUuid
  recordUuid: string | null;
  caseId: string | null;
  epcrAddress: string | null;
  realAddress: string | null;
  lat: number;
  lng: number;
  vx: number;
  vy: number;
  gpsUpdatedAt: string;
  staleMode: boolean; // true = gps "frozen" (stale)
  hrBaseline: number;
  spo2Baseline: number;
}

interface VitalsReading {
  recordUuid: string;
  createdAt: string;
  hr: number | null;
  spo2: number | null;
  NBPm: number | null;
  NBPs: number | null;
  NBPd: number | null;
  respRate: number | null;
  temp: number | null;
  CaseID: string | null;
}

const POLL_INTERVAL = 8;
const DISPATCH_MAX_MIN = 180;
const VITALS_MAX_MIN = 30;
const GPS_LIVE_MIN = 30;
const GPS_MAX_MIN = 60;
const EVENTS_MAX_MIN = 60;
const IMAGES_MAX_MIN = 60;
const NEW_CASE_MIN = 15;
const CASE_RETAIN_MIN = 15;
const KEEP_KNOWN = 800;
const VITAL_BASE = "https://epcr.tpf.gov.tw:4001";
const STREAM_BASE = "https://mer2voip.tpf.gov.tw:30080/live";

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function isoNow(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function minutesAgo(iso: string | null): number {
  if (!iso) return 99999;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 99999;
  return (Date.now() - t) / 60000;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function makeLicense(branchIdx: number): string {
  // Taiwanese license plate: 3 letters - 4 digits (e.g. ALC-1234)
  const letters = "ABDEFGHJKLMNPQRSTUVWZ";
  const l1 = letters[branchIdx % letters.length];
  const l2 = letters[(branchIdx * 3 + 1) % letters.length];
  const l3 = letters[(branchIdx * 5 + 2) % letters.length];
  const num = 1000 + branchIdx * 137 + randInt(0, 200);
  return `${l1}${l2}${l3}-${num}`;
}

function makeCaseId(): string {
  const yr = new Date().getFullYear();
  const n = randInt(100000, 999999);
  return `NTC${yr}-${n}`;
}

function makeAddress(district: string): string {
  const street = pick(STREETS);
  const section = randInt(1, 3);
  const house = randInt(1, 500);
  return `新北市${district}${street}${["一", "二", "三"][section - 1]}段${house}號`;
}

function makeShortAddress(): string {
  const street = pick(STREETS);
  const section = randInt(1, 3);
  const house = randInt(1, 500);
  return `${street}${["一", "二", "三"][section - 1]}段${house}號`;
}

function makeVillage(district: string): string {
  return `${district}${pick(VILLAGES)}`;
}

function jitterPosition(v: VehicleState): void {
  // Slight random walk — keep within ~0.02 deg of branch HQ.
  const b = BRANCHES.find((x) => x.name === v.branch)!;
  v.vx += rand(-0.00008, 0.00008);
  v.vy += rand(-0.00008, 0.00008);
  // Clamp velocity magnitude.
  const sp = Math.hypot(v.vx, v.vy);
  if (sp > 0.0012) {
    v.vx = (v.vx / sp) * 0.0012;
    v.vy = (v.vy / sp) * 0.0012;
  }
  v.lat += v.vx;
  v.lng += v.vy;
  // Soft pull back toward branch HQ if it drifts too far.
  const dlat = v.lat - b.lat;
  const dlng = v.lng - b.lng;
  if (Math.abs(dlat) > 0.02) v.vx -= Math.sign(dlat) * 0.00006;
  if (Math.abs(dlng) > 0.02) v.vy -= Math.sign(dlng) * 0.00006;
}

/* ------------------------------------------------------------------ *
 * Simulator class
 * ------------------------------------------------------------------ */

class Simulator {
  vehicles: VehicleState[] = [];
  vitalsHistory: Map<string, VitalsReading[]> = new Map();
  eventsHistory: DashboardEvent[] = [];
  imagesHistory: DashboardImage[] = [];
  knownDispatchUuids: Set<string> = new Set();
  knownRecordUuids: Set<string> = new Set();
  statusMap: Map<string, StatusId> = new Map();
  retainedNewCases: Map<
    string,
    { firstSeenAt: string; case: NewCase }
  > = new Map();
  caseSampleSize = 1248 + randInt(0, 12);
  avgReactionTime = rand(6.4, 8.2);
  avgWorkTime = rand(21.5, 24.6);
  availability = rand(86, 94);
  pollCount = 0;
  initialized = false;

  constructor() {
    this.init();
  }

  /** One-time setup: build 14 idle vehicles near each branch HQ. */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    BRANCHES.forEach((b, i) => {
      // codes: 板橋91, 三重91, 中和92, ... alternating 91/92.
      const code = `${b.name}${i % 2 === 0 ? 91 : 92}`;
      this.vehicles.push({
        branch: b.name,
        district: b.district,
        ambulanceCode: code,
        licenseNo: makeLicense(i),
        statusId: null,
        dispatchedAt: null,
        departedAt: null,
        arrivedAt: null,
        uuid: null,
        recordUuid: null,
        caseId: null,
        epcrAddress: null,
        realAddress: null,
        lat: b.lat + rand(-0.004, 0.004),
        lng: b.lng + rand(-0.004, 0.004),
        vx: rand(-0.0006, 0.0006),
        vy: rand(-0.0006, 0.0006),
        gpsUpdatedAt: isoNow(-randInt(1, 8) * 60000),
        staleMode: false,
        hrBaseline: randInt(70, 92),
        spo2Baseline: randInt(95, 99),
      });
    });
    // Seed an initial set of 7 active dispatches so the dashboard isn't empty.
    for (let k = 0; k < 7; k++) this.startNewDispatch();
  }

  /* ---------------- Dispatch lifecycle ---------------- */

  private startNewDispatch(): void {
    const idle = this.vehicles.filter((v) => v.statusId === null);
    if (idle.length === 0) return;
    const v = pick(idle);
    const b = BRANCHES.find((x) => x.name === v.branch)!;
    const dispatchedAtMs = -randInt(0, 12) * 60000 - randInt(0, 59000);
    v.statusId = 5;
    v.dispatchedAt = isoNow(dispatchedAtMs);
    v.departedAt = null;
    v.arrivedAt = null;
    v.uuid = randomUUID();
    v.recordUuid = randomUUID();
    v.caseId = makeCaseId();
    v.realAddress = makeAddress(v.district);
    v.epcrAddress = makeAddress(v.district);
    v.lat = b.lat + rand(-0.012, 0.012);
    v.lng = b.lng + rand(-0.012, 0.012);
    v.vx = rand(-0.0008, 0.0008);
    v.vy = rand(-0.0008, 0.0008);
    // ~15% of new dispatches are in "stale GPS" mode.
    v.staleMode = Math.random() < 0.15;
    v.gpsUpdatedAt = v.staleMode
      ? isoNow(-randInt(40, 55) * 60000)
      : isoNow(-randInt(1, 15) * 60000);
    v.hrBaseline = randInt(70, 95);
    v.spo2Baseline = randInt(95, 99);
    this.vitalsHistory.set(v.recordUuid, []);
  }

  private finishVehicle(v: VehicleState): void {
    if (v.recordUuid) {
      // keep history briefly so case detail still resolves; trim later
      this.vitalsHistory.delete(v.recordUuid);
    }
    v.statusId = null;
    v.dispatchedAt = null;
    v.departedAt = null;
    v.arrivedAt = null;
    v.uuid = null;
    v.recordUuid = null;
    v.caseId = null;
    v.epcrAddress = null;
    v.realAddress = null;
    v.staleMode = false;
  }

  /** Advance the whole simulation one step (called per snapshot). */
  private advance(): void {
    this.pollCount++;
    const now = Date.now();

    // 1. Per-vehicle updates: movement + status transitions.
    for (const v of this.vehicles) {
      if (v.statusId === null) {
        // Idle — small chance a new dispatch starts (handled below in balance step).
        continue;
      }
      // GPS: if not stale, refresh; if stale, keep old timestamp.
      if (!v.staleMode) {
        v.gpsUpdatedAt = isoNow(-randInt(0, 12) * 60000 - randInt(0, 59000));
      }
      // Move slightly toward current heading.
      jitterPosition(v);

      // Status progression with small probabilities.
      const sid = v.statusId;
      if (sid === 5 && Math.random() < 0.1) {
        v.statusId = 6;
        v.departedAt = isoNow();
      } else if (sid === 6 && Math.random() < 0.12) {
        v.statusId = 7;
        v.arrivedAt = isoNow();
        this.pushEvent("到達現場", v.uuid!);
      } else if (sid === 7 && Math.random() < 0.1) {
        v.statusId = 8;
        this.pushEvent("上車", v.uuid!);
        this.pushEvent("送醫", v.uuid!);
      } else if (sid === 8 && Math.random() < 0.06) {
        this.pushEvent("抵達醫院", v.uuid!);
        this.pushEvent("離開醫院", v.uuid!);
        if (Math.random() < 0.25) this.pushEvent("心跳恢復", v.uuid!);
        this.finishVehicle(v);
      }
    }

    // 2. Balance: keep 6-10 active.
    const activeCount = this.vehicles.filter((v) => v.statusId !== null).length;
    if (activeCount < 6) {
      this.startNewDispatch();
      if (activeCount < 5) this.startNewDispatch();
    } else if (activeCount > 10) {
      const candidates = this.vehicles.filter((v) => v.statusId === 8);
      if (candidates.length > 0) {
        const v = pick(candidates);
        this.pushEvent("抵達醫院", v.uuid!);
        this.pushEvent("離開醫院", v.uuid!);
        this.finishVehicle(v);
      } else {
        // Force-finish the oldest active.
        const sorted = this.vehicles
          .filter((v) => v.statusId !== null)
          .sort((a, b) => (a.dispatchedAt! < b.dispatchedAt! ? -1 : 1));
        if (sorted.length > 0) this.finishVehicle(sorted[0]);
      }
    }

    // 3. Occasional brand-new dispatch (independent of balance).
    if (Math.random() < 0.18) this.startNewDispatch();

    // 4. Vitals generation.
    this.advanceVitals(now);

    // 5. Image generation.
    if (Math.random() < 0.45) this.addImage();

    // 6. EDT KPI slow drift.
    if (this.pollCount % 4 === 0) {
      this.caseSampleSize += randInt(1, 3);
      this.avgReactionTime = clampDrift(this.avgReactionTime, 6.2, 8.4, 0.18);
      this.avgWorkTime = clampDrift(this.avgWorkTime, 21.0, 25.0, 0.22);
      this.availability = clampDrift(this.availability, 84, 95, 0.6);
    }

    // 7. Trim histories.
    this.trimHistories();
  }

  private advanceVitals(_now: number): void {
    const active = this.vehicles.filter(
      (v) => v.statusId !== null && v.recordUuid
    );
    for (const v of active) {
      // ~30% chance per poll to push a fresh reading for each active vehicle.
      if (Math.random() < 0.3) {
        const rec = this.makeVitalsReading(v);
        const arr = this.vitalsHistory.get(v.recordUuid!) ?? [];
        arr.push(rec);
        if (arr.length > 50) arr.shift();
        this.vitalsHistory.set(v.recordUuid!, arr);
      }
    }
    // Occasional anomaly: one vehicle gets high HR or low SpO2.
    if (Math.random() < 0.35 && active.length > 0) {
      const v = pick(active);
      const rec = this.makeVitalsReading(v, /* anomaly */ true);
      const arr = this.vitalsHistory.get(v.recordUuid!) ?? [];
      arr.push(rec);
      if (arr.length > 50) arr.shift();
      this.vitalsHistory.set(v.recordUuid!, arr);
    }
  }

  private makeVitalsReading(
    v: VehicleState,
    anomaly = false
  ): VitalsReading {
    const anomalyHighHr = anomaly && Math.random() < 0.5;
    const anomalyLowSpo2 = anomaly && !anomalyHighHr;
    const hr = anomalyHighHr
      ? randInt(125, 148)
      : clampInt(v.hrBaseline + randInt(-6, 6), 50, 160);
    const spo2 = anomalyLowSpo2
      ? randInt(82, 89)
      : clampInt(v.spo2Baseline + randInt(-2, 1), 80, 100);
    const NBPm = clampInt(110 + randInt(-18, 18), 70, 200);
    const NBPs = clampInt(NBPm - randInt(30, 50), 50, 160);
    const NBPd = clampInt(NBPm - randInt(50, 70), 40, 130);
    return {
      recordUuid: v.recordUuid!,
      createdAt: isoNow(),
      hr,
      spo2,
      NBPm,
      NBPs,
      NBPd,
      respRate: randInt(12, 22),
      temp: Number(rand(36.3, 37.4).toFixed(1)),
      CaseID: v.caseId,
    };
  }

  private addImage(): void {
    const active = this.vehicles.filter(
      (v) => v.statusId !== null && v.recordUuid
    );
    if (active.length === 0) return;
    const v = pick(active);
    const id = randomUUID();
    this.imagesHistory.push({
      id,
      recordUuid: v.recordUuid!,
      fileName: `ecg_${Date.now()}_${randInt(1, 99)}.jpg`,
      createdAt: isoNow(),
      download: `${VITAL_BASE}/imageData/getFile/${id}`,
    });
  }

  private pushEvent(EventType: string, uuid: string): void {
    this.eventsHistory.push({
      EventType,
      Timestamp: isoNow(),
      recordUuid: uuid,
    });
  }

  private trimHistories(): void {
    const cutEvents = Date.now() - EVENTS_MAX_MIN * 60000;
    this.eventsHistory = this.eventsHistory
      .filter((e) => Date.parse(e.Timestamp) >= cutEvents)
      .slice(-40);
    const cutImages = Date.now() - IMAGES_MAX_MIN * 60000;
    this.imagesHistory = this.imagesHistory
      .filter((i) => Date.parse(i.createdAt) >= cutImages)
      .slice(-20);
    // Cap known sets (FIFO).
    if (this.knownDispatchUuids.size > KEEP_KNOWN) {
      const arr = Array.from(this.knownDispatchUuids).slice(-KEEP_KNOWN);
      this.knownDispatchUuids = new Set(arr);
    }
    if (this.knownRecordUuids.size > KEEP_KNOWN) {
      const arr = Array.from(this.knownRecordUuids).slice(-KEEP_KNOWN);
      this.knownRecordUuids = new Set(arr);
    }
  }

  /** 新案件首次出現後保留 CASE_RETAIN_MIN 分鐘。 */
  private applyNewCaseRetention(
    fresh: NewCase[],
    dispatchIndex: Map<string, LiveUnit>,
  ): NewCase[] {
    for (const c of fresh) {
      const key = c.uuid || c.recordUuid || "";
      if (!key) continue;
      const prev = this.retainedNewCases.get(key);
      if (!prev) {
        this.retainedNewCases.set(key, {
          firstSeenAt: isoNow(),
          case: { ...c, isNew: true },
        });
      } else {
        this.retainedNewCases.set(key, {
          ...prev,
          case: { ...prev.case, ...c },
        });
      }
    }

    const out: NewCase[] = [];
    for (const [key, entry] of this.retainedNewCases) {
      const age = minutesAgo(entry.firstSeenAt);
      if (age > CASE_RETAIN_MIN) {
        this.retainedNewCases.delete(key);
        continue;
      }
      const merged: NewCase = { ...entry.case };
      if (merged.uuid && dispatchIndex.has(merged.uuid)) {
        Object.assign(merged, dispatchIndex.get(merged.uuid));
      }
      merged.firstSeenAt = entry.firstSeenAt;
      merged.retainSecLeft = Math.max(0, Math.floor((CASE_RETAIN_MIN - age) * 60));
      out.push(merged);
      void key;
    }
    out.sort((a, b) =>
      (b.dispatchedAt || "").localeCompare(a.dispatchedAt || ""),
    );
    return out;
  }

  /* ---------------- Snapshot construction ---------------- */

  snapshot(): DashboardData {
    this.advance();

    // Build the live dispatched units list (merged dispatch + GPS).
    const liveUnits: LiveUnit[] = this.vehicles
      .filter((v) => v.statusId !== null)
      .map((v) => this.toLiveUnit(v));

    // Sort: live GPS first, then stale, then by age.
    liveUnits.sort((a, b) => {
      if (a.gpsLive !== b.gpsLive) return a.gpsLive ? -1 : 1;
      return a.ageMin - b.ageMin;
    });

    // GPS points (same shape + isLive).
    const gps: GpsPoint[] = liveUnits.map((u) => ({
      uuid: u.uuid,
      ambulanceCode: u.ambulanceCode,
      licenseNo: u.licenseNo,
      branch: u.branch,
      statusId: u.statusId,
      statusName: u.statusName,
      realAddress: u.realAddress,
      lat: u.lat,
      lng: u.lng,
      gpsUpdatedAt: u.gpsUpdatedAt,
      gpsAgeMin: u.gpsAgeMin,
      dispatchedAt: u.dispatchedAt,
      dispAgeMin: u.ageMin,
      isLive: u.gpsLive,
      isStale: u.isStale,
    }));

    // Vitals — latest per recordUuid within 30 min, ≤20 entries.
    const vitals: Vitals[] = [];
    for (const v of this.vehicles) {
      if (!v.recordUuid) continue;
      const arr = this.vitalsHistory.get(v.recordUuid) ?? [];
      if (arr.length === 0) continue;
      const latest = arr[arr.length - 1];
      const ageMin = minutesAgo(latest.createdAt);
      if (ageMin > VITALS_MAX_MIN) continue;
      vitals.push({
        recordUuid: latest.recordUuid,
        lastSeen: latest.createdAt,
        ageMin: Number(ageMin.toFixed(1)),
        hr: latest.hr,
        spo2: latest.spo2,
        NBPm: latest.NBPm,
        NBPs: latest.NBPs,
        NBPd: latest.NBPd,
        respRate: latest.respRate,
        temp: latest.temp,
        CaseID: latest.CaseID,
      });
    }
    vitals.sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
    const vitalsTop = vitals.slice(0, 20);

    // Events — recent ≤10.
    const events: DashboardEvent[] = [...this.eventsHistory]
      .sort((a, b) => (a.Timestamp < b.Timestamp ? 1 : -1))
      .slice(0, 10);

    // Images — recent ≤8.
    const images: DashboardImage[] = [...this.imagesHistory]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 8);

    // Live video — subset of liveUnits with statusId === 8.
    const liveVideo: LiveUnit[] = liveUnits.filter((u) => u.statusId === 8);

    // Status counts.
    const statusCounts: StatusCounts = { all: 0, 5: 0, 6: 0, 7: 0, 8: 0 };
    for (const u of liveUnits) {
      statusCounts.all++;
      statusCounts[u.statusId]++;
    }

    // EDT branches (all 14).
    const edtBranches: EdtBranch[] = BRANCHES.map((b) => {
      const activeFromBranch = liveUnits.filter((u) => u.branch === b.name).length;
      return {
        name: b.name,
        district: b.district,
        ambulanceSum: 1,
        dispatchSum: activeFromBranch + randInt(0, 1),
      };
    });
    const branches: RawBranch[] = edtBranches.map((b) => ({
      name: b.name,
      district: b.district,
      ambulanceSum: b.ambulanceSum,
      dispatchSum: b.dispatchSum,
    }));

    // EDT KPI.
    const ambulanceSum = 14;
    const ambulanceWorking = liveUnits.length;
    const branchWorking = new Set(liveUnits.map((u) => u.branch)).size;
    const vehicleUsagePct =
      ambulanceSum > 0
        ? Number(((ambulanceWorking / ambulanceSum) * 100).toFixed(1))
        : 0;
    const branchUsagePct =
      ambulanceSum > 0
        ? Number(((branchWorking / 14) * 100).toFixed(1))
        : 0;
    const edtKpi: EdtKpi = {
      source: "resourceManagement",
      gpsNote: "GPS 同源 · 8秒輪詢",
      caseSampleSize: this.caseSampleSize,
      avgReactionTime: Number(this.avgReactionTime.toFixed(1)),
      avgWorkTime: Number(this.avgWorkTime.toFixed(1)),
      ambulanceSum,
      ambulanceWorking,
      vehicleUsagePct,
      branchSum: 14,
      branchWorking,
      branchUsagePct,
      availability: Number(this.availability.toFixed(1)),
      prCarUseSum: ambulanceWorking + 2,
      prCarSum: 18,
    };

    // Detect new cases / alerts (delta from previous poll).
    const newCases: NewCase[] = [];
    const alerts: Alert[] = [];
    for (const u of liveUnits) {
      const isNew = !this.knownDispatchUuids.has(u.uuid);
      const oldStatus = this.statusMap.get(u.uuid);
      if (isNew && u.ageMin <= NEW_CASE_MIN) {
        newCases.push({ ...u, caseType: "dispatch", isNew: true });
        alerts.push({
          type: "new_case",
          priority: 1,
          msg: `新案件 ${u.ambulanceCode} | ${u.branch} | ${u.statusName}`,
          data: u,
        });
      } else if (oldStatus !== undefined && oldStatus !== u.statusId) {
        alerts.push({
          type: "status_change",
          priority: 2,
          msg: `狀態變更 ${u.ambulanceCode}: ${STATUS_MAP[oldStatus]} → ${u.statusName}`,
          data: u,
        });
        if (u.statusId === 8) {
          alerts.push({
            type: "live_video",
            priority: 1,
            msg: `即時影像上線 ${u.ambulanceCode} ${u.branch}`,
            data: u,
          });
        }
      }
      this.knownDispatchUuids.add(u.uuid);
      this.statusMap.set(u.uuid, u.statusId);
    }
    for (const vit of vitalsTop) {
      const rid = vit.recordUuid;
      const isNewRec = !this.knownRecordUuids.has(rid);
      const fresh = vit.ageMin <= 10;
      if (isNewRec && fresh) {
        alerts.push({
          type: "new_vitals",
          priority: 1,
          msg: `新生命徵象 ${rid.slice(0, 8)}… HR=${vit.hr ?? "-"} SpO2=${vit.spo2 ?? "-"}`,
          data: vit,
        });
      }
      if (typeof vit.hr === "number" && vit.hr > 120) {
        alerts.push({
          type: "high_hr",
          priority: 2,
          msg: `高心率 ${rid.slice(0, 8)}… HR=${vit.hr}`,
          data: vit,
        });
      }
      if (typeof vit.spo2 === "number" && vit.spo2 < 90) {
        alerts.push({
          type: "low_spo2",
          priority: 2,
          msg: `低血氧 ${rid.slice(0, 8)}… SpO2=${vit.spo2}`,
          data: vit,
        });
      }
      this.knownRecordUuids.add(rid);
    }
    const dispatchIndex = new Map(
      liveUnits.map((u) => [u.uuid, u] as const),
    );
    const retainedCases = this.applyNewCaseRetention(newCases, dispatchIndex);
    alerts.sort((a, b) => a.priority - b.priority);

    const filters: Filters = {
      dispatchMaxMin: DISPATCH_MAX_MIN,
      vitalsMaxMin: VITALS_MAX_MIN,
      gpsLiveMin: GPS_LIVE_MIN,
      gpsMaxMin: GPS_MAX_MIN,
      eventsMaxMin: EVENTS_MAX_MIN,
      imagesMaxMin: IMAGES_MAX_MIN,
    };

    const summary: Summary = {
      activeDispatches: liveUnits.length,
      liveVitals: vitalsTop.length,
      gpsPoints: gps.length,
      gpsLive: gps.filter((g) => g.isLive).length,
      liveVideoCases: liveVideo.length,
      newCasesThisPoll: retainedCases.length,
      recentEvents: events.length,
      recentImages: images.length,
      totalAlerts: alerts.length,
      status5: statusCounts[5],
      status6: statusCounts[6],
      status7: statusCounts[7],
      status8: statusCounts[8],
    };

    return {
      updatedAt: isoNow(),
      tokenOk: true,
      pollInterval: POLL_INTERVAL,
      filters,
      dataNote: `派遣≤${DISPATCH_MAX_MIN}分鐘 · GPS即時≤${GPS_LIVE_MIN}分 · 即時輪詢`,
      summary,
      statusCounts,
      edtKpi,
      edtBranches,
      newCases: retainedCases.slice(0, 20),
      alerts: alerts.slice(0, 10),
      dispatches: liveUnits,
      liveUnits,
      gps,
      vitals: vitalsTop,
      liveVideo,
      images,
      events,
      branches,
    };
  }

  private toLiveUnit(v: VehicleState): LiveUnit {
    const gpsAge = v.staleMode
      ? minutesAgo(v.gpsUpdatedAt)
      : minutesAgo(v.gpsUpdatedAt);
    const isLive = gpsAge <= GPS_LIVE_MIN;
    const sid = v.statusId!;
    const dispAge = minutesAgo(v.dispatchedAt);
    const actAge = Math.min(
      minutesAgo(v.dispatchedAt),
      minutesAgo(v.departedAt),
      minutesAgo(v.arrivedAt)
    );
    const ageMin = Math.min(dispAge, actAge);
    return {
      uuid: v.uuid!,
      statusId: sid,
      statusName: STATUS_MAP[sid],
      branch: v.branch,
      ambulanceCode: v.ambulanceCode,
      licenseNo: v.licenseNo,
      dispatchedAt: v.dispatchedAt!,
      departedAt: v.departedAt,
      arrivedAt: v.arrivedAt,
      ageMin: Number(ageMin.toFixed(1)),
      gpsLive: isLive,
      isStale: !isLive,
      hasLiveVideo: sid === 8,
      lat: Number(v.lat.toFixed(6)),
      lng: Number(v.lng.toFixed(6)),
      gpsAgeMin: Number(gpsAge.toFixed(1)),
      gpsUpdatedAt: v.gpsUpdatedAt,
      epcrAddress: v.epcrAddress,
      realAddress: v.realAddress,
      caseId: v.caseId,
    };
  }

  /* ---------------- Case detail (per-uuid) ---------------- */

  caseDetail(uuid: string): CaseDetail {
    // Find vehicle by dispatch uuid OR record uuid.
    let v = this.vehicles.find((x) => x.uuid === uuid);
    let isRecord = false;
    if (!v) {
      v = this.vehicles.find((x) => x.recordUuid === uuid);
      if (v) isRecord = true;
    }
    const rid = isRecord ? uuid : v?.recordUuid ?? uuid;
    const readings = this.vitalsHistory.get(rid) ?? [];

    // Synthesize a ~20-minute trend (backfill if too few).
    const trendings: CaseTrendingPoint[] = [];
    const now = Date.now();
    const stepMs = 60000; // 1-min spacing
    const baseline = v
      ? { hr: v.hrBaseline, spo2: v.spo2Baseline }
      : { hr: 78, spo2: 97 };
    for (let i = 20; i >= 0; i--) {
      const t = now - i * stepMs;
      const r = readings.find(
        (x) => Math.abs(Date.parse(x.createdAt) - t) < stepMs / 2
      );
      trendings.push({
        createdAt: new Date(t).toISOString(),
        hr: r?.hr ?? clampInt(baseline.hr + randInt(-6, 6), 50, 160),
        spo2: r?.spo2 ?? clampInt(baseline.spo2 + randInt(-2, 1), 80, 100),
        NBPm: r?.NBPm ?? clampInt(110 + randInt(-15, 15), 70, 200),
        NBPs: r?.NBPs ?? clampInt(75 + randInt(-10, 10), 50, 160),
        NBPd: r?.NBPd ?? clampInt(60 + randInt(-8, 8), 40, 130),
        respRate: r?.respRate ?? randInt(12, 22),
        temperature: r?.temp ?? Number(rand(36.3, 37.4).toFixed(1)),
        recordUuid: rid,
        CaseID: v?.caseId ?? null,
      });
    }

    // Synthesize ~6 case events for the timeline.
    const eventLabels = ["到達現場", "上車", "送醫", "抵達醫院", "心跳恢復", "離開醫院"];
    const events: CaseEvent[] = eventLabels.map((label, i) => ({
      EventType: label,
      Timestamp: new Date(now - (eventLabels.length - i) * 4 * 60000).toISOString(),
      recordUuid: rid,
    }));

    // Synthesize 3-5 images.
    const imgs: CaseImage[] = [];
    const n = randInt(3, 5);
    for (let i = 0; i < n; i++) {
      const id = randomUUID();
      imgs.push({
        id,
        fileName: `ecg_${now + i}_${i + 1}.jpg`,
        url: `${VITAL_BASE}/imageData/getFile/${id}`,
        createdAt: new Date(now - i * 3 * 60000).toISOString(),
      });
    }

    // AI ECG: 0-2 results.
    const aiEcg: AiEcg[] = [];
    if (Math.random() < 0.6) {
      aiEcg.push({
        id: randomUUID(),
        result: pick(["Normal Sinus Rhythm", "Sinus Tachycardia", "Atrial Fibrillation", "Ventricular Fibrillation"]),
        confidence: Number(rand(0.72, 0.96).toFixed(2)),
        createdAt: new Date(now - randInt(2, 8) * 60000).toISOString(),
      });
    }

    return {
      trendings,
      events,
      images: imgs,
      aiEcg,
      streamUrl: `${STREAM_BASE}?app=rtmp&stream=live${rid}`,
    };
  }
}

/* ------------------------------------------------------------------ *
 * Utility clamps
 * ------------------------------------------------------------------ */

function clampInt(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(x)));
}

function clampDrift(
  val: number,
  min: number,
  max: number,
  step: number
): number {
  let next = val + rand(-step, step);
  if (next < min) next = min + rand(0, step);
  if (next > max) next = max - rand(0, step);
  return next;
}

/* ------------------------------------------------------------------ *
 * Singleton — survives HMR via globalThis
 * ------------------------------------------------------------------ */

declare global {
  var __emicSimulator: Simulator | undefined;
}

export function getSimulator(): Simulator {
  if (!globalThis.__emicSimulator) {
    globalThis.__emicSimulator = new Simulator();
  }
  return globalThis.__emicSimulator;
}
