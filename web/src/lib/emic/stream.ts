import type { CaseDetail, DashboardData } from "@/lib/emic/types";
import { emicFeatures } from "@/lib/emic/features";

/** Upstream VoIP host — server-side only, never sent to the browser. */
const STREAM_UPSTREAM =
  process.env.EMIC_STREAM_UPSTREAM ?? "https://mer2voip.tpf.gov.tw:30080/live";

/** Build the real upstream MSE URL (server-side only). */
export function buildUpstreamStreamUrl(recordId: string): string {
  const id = recordId.trim();
  return `${STREAM_UPSTREAM}?app=rtmp&stream=live${id}`;
}

/** Opaque authenticated proxy path exposed to the frontend. */
export function streamProxyPath(recordId: string): string {
  return `/api/emic/stream?id=${encodeURIComponent(recordId.trim())}`;
}

/** Strip upstream stream URLs from dashboard payloads. */
export function sanitizeDashboardData(data: DashboardData): DashboardData {
  const stripUnit = <T extends { mseUrl?: string | null }>(u: T): Omit<T, "mseUrl"> => {
    const { mseUrl: _mse, ...rest } = u;
    return rest;
  };
  const stripVital = <T extends { streamUrl?: string }>(v: T): Omit<T, "streamUrl"> => {
    const { streamUrl: _s, ...rest } = v;
    return rest;
  };
  const stripGpsCase = <
    T extends {
      gpsCaseAddress?: string | null;
      gpsCaseNlsc?: string | null;
      gpsCaseTrigger?: string | null;
      gpsCaseRecordedAt?: string | null;
    },
  >(
    u: T,
  ) => {
    const {
      gpsCaseAddress: _a,
      gpsCaseNlsc: _n,
      gpsCaseTrigger: _t,
      gpsCaseRecordedAt: _r,
      ...rest
    } = u;
    return rest;
  };

  let out: DashboardData = {
    ...data,
    dispatches: data.dispatches.map(stripUnit),
    liveUnits: data.liveUnits.map(stripUnit),
    liveVideo: data.liveVideo.map(stripUnit),
    vitals: data.vitals.map(stripVital),
  } as DashboardData;

  if (!emicFeatures.gpsCases) {
    out = {
      ...out,
      gpsCases: [],
      gpsCasesRecent: [],
      alerts: out.alerts.filter((a) => a.type !== "gps_arrived"),
      dispatches: out.dispatches.map(stripGpsCase),
      liveUnits: out.liveUnits.map(stripGpsCase),
      summary: { ...out.summary, gpsCases: 0 },
    };
  }
  if (!emicFeatures.edt) {
    out = {
      ...out,
      edtKpi: {
        ...out.edtKpi,
        source: "disabled",
        gpsNote: out.edtKpi.gpsNote || "GPS 8秒輪詢",
      },
      edtBranches: [],
      branches: [],
    };
  }

  return out;
}

type CaseDetailRaw = Omit<CaseDetail, "hasStream"> & { streamUrl?: string };

/** Strip upstream stream URL from case detail; expose only a boolean flag. */
export function sanitizeCaseDetail(detail: CaseDetailRaw): CaseDetail {
  const hasStream = Boolean(detail.streamUrl);
  const { streamUrl: _s, ...rest } = detail;
  return { ...rest, hasStream };
}