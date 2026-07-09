"use client";

import { useEmicStore } from "@/lib/emic/store";
import { esc } from "@/lib/emic/format";
import { sortEmicKmlCasesNewestFirst } from "@/lib/emic/kml-shared";
import type { EmicKmlCase, GpsPoint } from "@/lib/emic/types";

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR;
  const dLng = (lng2 - lng1) * toR;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nearestAmb(
  c: EmicKmlCase,
  gps: GpsPoint[],
): { code: string; km: string } | null {
  let best: GpsPoint | null = null;
  let bestD = Infinity;
  gps.forEach((p) => {
    if (!p.lat || !p.lng) return;
    const d = haversineKm(c.lat, c.lng, p.lat, p.lng);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  });
  if (!best || bestD > 80) return null;
  return {
    code: best.ambulanceCode,
    km: bestD < 1 ? bestD.toFixed(2) : bestD.toFixed(1),
  };
}

export function EmicKmlList({ compact = false }: { compact?: boolean }) {
  const emicKml = useEmicStore((s) => s.emicKml);
  const data = useEmicStore((s) => s.data);
  const selectedEmicId = useEmicStore((s) => s.selectedEmicId);
  const setSelectedEmicId = useEmicStore((s) => s.setSelectedEmicId);
  const setEmicMapOn = useEmicStore((s) => s.setEmicMapOn);
  const setMobileView = useEmicStore((s) => s.setMobileView);
  const pauseMap = useEmicStore((s) => s.pauseMap);

  function selectEmic(id: string) {
    setSelectedEmicId(id);
    setEmicMapOn(true);
    pauseMap(10000);
    setMobileView("map");
  }

  const cases = sortEmicKmlCasesNewestFirst(emicKml?.cases || []);
  const gps = data?.gps || [];

  if (!emicKml) {
    return <div className="empty">載入 EMIC KML…</div>;
  }
  if (!cases.length) {
    return <div className="empty">目前篩選條件下無災情通報</div>;
  }

  return (
    <>
      {cases.map((c) => {
        const near = nearestAmb(c, gps);
        const on = selectedEmicId === c.id;
        return (
          <div
            key={c.id}
            className={`emic-kml-item${on ? " on" : ""}${compact ? " compact" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => selectEmic(c.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                selectEmic(c.id);
              }
            }}
          >
            <div className="emic-kml-head">
              <span className="emic-kml-cat">{esc(c.category || c.name)}</span>
              <span
                className={`status-pill ${c.isActive ? "s8" : "s5"}`}
              >
                {esc(c.status || "—")}
              </span>
            </div>
            <div className="emic-kml-addr">{esc(c.address || "—")}</div>
            <div className="emic-kml-meta">
              <span>{esc(c.reportTime || "—")}</span>
              {near ? (
                <span className="emic-kml-near">
                  {esc(near.code)} · {near.km}km
                </span>
              ) : (
                <span>—</span>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}