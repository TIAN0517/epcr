import type { StatusId } from "@/lib/emic/types";

export const STATUS_CLS: Record<number, string> = {
  5: "s5",
  6: "s6",
  7: "s7",
  8: "s8",
};

export const STATUS_LABEL: Record<number, string> = {
  5: "已派遣",
  6: "已出發",
  7: "已到達",
  8: "執行中(影像)",
};

export const STATUS_COLOR: Record<number, string> = {
  5: "#ca8a04",
  6: "#ea580c",
  7: "#2563eb",
  8: "#16a34a",
};

export const STATUS_ID_BY_NAME: Record<string, number> = {
  已派遣: 5,
  已出發: 6,
  已到達: 7,
  "執行中(有影像)": 8,
  "執行中(影像)": 8,
};

/** Format an ISO timestamp as HH:MM:SS (zh-TW, 24h). */
export function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("zh-TW", { hour12: false });
  } catch {
    return "—";
  }
}

/** Format an ISO timestamp as MM/DD HH:MM. */
export function fmtShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${mm}/${dd} ${fmt(iso)}`;
  } catch {
    return "—";
  }
}

export function statusPill(sid: number | null | undefined, name?: string): string {
  const cls = (sid != null && STATUS_CLS[sid]) || "s8";
  const label = name || (sid != null ? STATUS_LABEL[sid] : "—");
  return `<span class="status-pill ${cls}">${label}</span>`;
}

export function esc(s: unknown): string {
  return String(s ?? "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function isCoordText(s: string | null | undefined): boolean {
  return /^-?\d+\.\d+\s*,\s*-?\d+\.\d+$/.test(String(s ?? "").trim());
}

export function normAddr(s: string | null | undefined): string {
  if (!s) return "";
  return String(s)
    .replace(/\s+/g, "")
    .replace(/臺/g, "台");
}

export interface AddrCmp {
  cls: string;
  text: string;
}

export function compareAddr(aRaw: string | null, bRaw: string | null): AddrCmp {
  const a = normAddr(aRaw);
  const b = normAddr(bRaw);
  if (!a && !b) return { cls: "", text: "—" };
  if (!a || !b) return { cls: "addr-warn", text: "缺資料" };
  if (a === b || a.includes(b) || b.includes(a))
    return { cls: "addr-match", text: "✓ 一致" };
  const pick = (t: string) =>
    (t.match(/[新北台北基隆桃園][市縣]?[^區鄉鎮市]{0,6}[區鄉鎮市][^\d,，]{2,}/) ||
      [])[0] ||
    t.slice(0, 12);
  const pa = pick(a);
  const pb = pick(b);
  if (
    pa &&
    pb &&
    (a.includes(pb.slice(-6)) || b.includes(pa.slice(-6)))
  )
    return { cls: "addr-match", text: "≈ 相近" };
  return { cls: "addr-diff", text: "≠ 不同" };
}

export function compareAddrLines(
  epcr: string | null,
  real: string | null,
  rev: string | null,
  nlsc: string | null,
): { cls: string; html: string } {
  const lines: string[] = [];
  const official = epcr || real;
  if (official && rev) {
    const c = compareAddr(official, rev);
    lines.push(`EPCR ↔ 反查：${c.text}`);
  }
  if (rev && nlsc) {
    const c = compareAddr(nlsc, rev);
    lines.push(`NLSC ↔ 反查：${c.text}`);
  }
  if (!lines.length) return { cls: "addr-warn", html: "尚無可對照地址" };
  const worst = lines.some((l) => l.includes("不同"))
    ? "addr-diff"
    : lines.some((l) => l.includes("缺"))
      ? "addr-warn"
      : "addr-match";
  return { cls: worst, html: lines.join("<br>") };
}

export function pickFullAddress(g: {
  fullAddress?: string;
  display?: string;
  error?: string;
} | null | undefined): string {
  if (!g || (g as { error?: string }).error) return "";
  const a = String(g.fullAddress || g.display || "").trim();
  if (!a || a === "—" || isCoordText(a) || a.includes("反查失敗") || a.includes("未啟用"))
    return "";
  return a;
}

export function navUrls(lat: number, lng: number): {
  google: string;
  apple: string;
  osm: string;
} {
  const q = `${lat},${lng}`;
  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`,
    apple: `https://maps.apple.com/?daddr=${encodeURIComponent(q)}`,
    osm: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`,
  };
}

/** Filter codes used by the right-dock status filter. */
export type DispFilter = "" | "5" | "6" | "7" | "8";
export type GpsFilter = "live" | "all";
export type MobileView = "map" | "left" | "right";

export const ACTIVE_STATUSES: StatusId[] = [5, 6, 7, 8];
