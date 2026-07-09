"use client";

import { create } from "zustand";
import type {
  Alert,
  DashboardData,
  EmicKmlRegion,
  EmicKmlResponse,
} from "@/lib/emic/types";
import type { DispFilter, GpsFilter, MobileView } from "@/lib/emic/format";

export type NotifyState = "default" | "granted" | "denied" | "unsupported";

interface EmicState {
  data: DashboardData | null;
  setData: (d: DashboardData) => void;

  /** Previous poll's alert signatures — used to detect NEW alerts for notifications. */
  seenAlertSigs: Set<string>;
  markAlertSeen: (sigs: string[]) => void;

  /** 已通知過的案件 key（uuid / recordUuid）— 倒數計時 toast 用 */
  seenCaseKeys: Set<string>;
  markCasesSeen: (keys: string[]) => void;

  selectedAmb: string;
  setSelectedAmb: (code: string) => void;

  dispFilter: DispFilter;
  setDispFilter: (f: DispFilter) => void;

  gpsFilter: GpsFilter;
  setGpsFilter: (f: GpsFilter) => void;

  mobileView: MobileView;
  setMobileView: (v: MobileView) => void;

  /** Pause map auto-refresh (ms epoch until which refresh is skipped). */
  mapPausedUntil: number;
  pauseMap: (ms: number) => void;

  /** Which case modal is open (uuid). */
  openCaseId: string | null;
  setOpenCaseId: (id: string | null) => void;

  /** Video wall visibility. */
  videoWallOpen: boolean;
  setVideoWallOpen: (b: boolean) => void;

  /** Connection error flag. */
  connError: boolean;
  setConnError: (b: boolean) => void;

  /** Consecutive poll failures (for backoff). */
  failCount: number;
  bumpFail: () => void;
  resetFail: () => void;

  /** Browser notification permission state. */
  notify: NotifyState;
  setNotify: (s: NotifyState) => void;

  /** EMIC 災情 KML */
  emicKml: EmicKmlResponse | null;
  setEmicKml: (d: EmicKmlResponse | null) => void;
  emicRegion: EmicKmlRegion;
  emicActiveOnly: boolean;
  emicMapOn: boolean;
  setEmicRegion: (r: EmicKmlRegion) => void;
  setEmicActiveOnly: (b: boolean) => void;
  setEmicMapOn: (b: boolean) => void;
  selectedEmicId: string;
  setSelectedEmicId: (id: string) => void;
  leftPane: "new" | "stats" | "vitals" | "more";
  setLeftPane: (p: "new" | "stats" | "vitals" | "more") => void;
}

export const useEmicStore = create<EmicState>((set) => ({
  data: null,
  setData: (d) => set({ data: d }),

  seenAlertSigs: new Set<string>(),
  markAlertSeen: (sigs) =>
    set({ seenAlertSigs: new Set(sigs) }),

  seenCaseKeys: new Set<string>(),
  markCasesSeen: (keys) =>
    set({ seenCaseKeys: new Set(keys) }),

  selectedAmb: "",
  setSelectedAmb: (code) => set({ selectedAmb: code }),

  dispFilter: "",
  setDispFilter: (f) => set({ dispFilter: f }),

  gpsFilter: "live",
  setGpsFilter: (f) => set({ gpsFilter: f }),

  mobileView: "map",
  setMobileView: (v) => set({ mobileView: v }),

  mapPausedUntil: 0,
  pauseMap: (ms) => set({ mapPausedUntil: Date.now() + ms }),

  openCaseId: null,
  setOpenCaseId: (id) => set({ openCaseId: id }),

  videoWallOpen: false,
  setVideoWallOpen: (b) => set({ videoWallOpen: b }),

  connError: false,
  setConnError: (b) => set({ connError: b }),

  failCount: 0,
  bumpFail: () => set((s) => ({ failCount: s.failCount + 1 })),
  resetFail: () => set({ failCount: 0 }),

  notify: "default",
  setNotify: (s) => set({ notify: s }),

  emicKml: null,
  setEmicKml: (d) => set({ emicKml: d }),
  emicRegion: "kaohsiung",
  emicActiveOnly: false,
  emicMapOn: true,
  setEmicRegion: (r) => set({ emicRegion: r }),
  setEmicActiveOnly: (b) => set({ emicActiveOnly: b }),
  setEmicMapOn: (b) => set({ emicMapOn: b }),
  selectedEmicId: "",
  setSelectedEmicId: (id) => set({ selectedEmicId: id }),
  leftPane: "new",
  setLeftPane: (p) => set({ leftPane: p }),
}));

/** Alert types that warrant a desktop notification. */
export const NOTIFY_ALERT_TYPES = new Set<Alert["type"]>([
  "new_case",
  "live_video",
  "gps_arrived",
  "high_hr",
  "low_spo2",
  "status_change",
  "emic_kml",
]);

/** Compute a stable signature for an alert so we can detect *new* ones. */
export function alertSig(a: Alert): string {
  return `${a.type}|${a.priority}|${a.msg}`;
}

/** Current effective poll interval given the failure count (exponential backoff). */
export function effectivePollMs(baseMs: number, failCount: number): number {
  if (failCount <= 0) return baseMs;
  // 8s → 16s → 32s → 60s (cap)
  const factor = Math.min(Math.pow(2, failCount), 8);
  return Math.min(baseMs * factor, 60000);
}
