"use client";

import { useEffect, useRef, useState } from "react";
import { useEmicStore } from "@/lib/emic/store";
import { fmt, esc, type DispFilter } from "@/lib/emic/format";
import { emicFeatures } from "@/lib/emic/features";
import type { LiveUnit } from "@/lib/emic/types";
import { Video, TriangleAlert } from "lucide-react";
import { TableSkeleton } from "./skeletons";
import { EmicKmlList } from "@/components/emic/emic-kml-list";
import { EmicKmlFilters } from "@/components/emic/emic-kml-filters";

export function RightDock() {
  const data = useEmicStore((s) => s.data);
  const emicKml = useEmicStore((s) => s.emicKml);
  const setLeftPane = useEmicStore((s) => s.setLeftPane);
  const dispFilter = useEmicStore((s) => s.dispFilter);
  const setDispFilter = useEmicStore((s) => s.setDispFilter);
  const selectedAmb = useEmicStore((s) => s.selectedAmb);
  const setSelectedAmb = useEmicStore((s) => s.setSelectedAmb);
  const setMobileView = useEmicStore((s) => s.setMobileView);
  const mobileView = useEmicStore((s) => s.mobileView);
  const prevDispState = useRef<Record<string, string>>({});
  const [flashing, setFlashing] = useState<Set<string>>(new Set());

  // Compute flashing rows (changed since last poll) in an effect; never
  // read refs during render. Depends only on data + filter identity.
  useEffect(() => {
    if (!data) return;
    let l: LiveUnit[] = data.liveUnits || data.dispatches || [];
    if (dispFilter) l = l.filter((x) => String(x.statusId) === dispFilter);
    const changed = new Set<string>();
    const next: Record<string, string> = {};
    l.forEach((x) => {
      const key = x.uuid || x.ambulanceCode;
      const sig = [x.statusId, x.gpsAgeMin, x.lat, x.lng].join("|");
      next[key] = sig;
      if (prevDispState.current[key] && prevDispState.current[key] !== sig)
        changed.add(key);
    });
    prevDispState.current = next;
    if (changed.size) {
      // Derived flash state: must compare to previous render's signatures,
      // so it is computed in an effect and pushed to state. This is the
      // canonical "adjust state when props change" escape hatch.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFlashing(changed);
      const t = setTimeout(() => setFlashing(new Set()), 1200);
      return () => clearTimeout(t);
    }
  }, [data, dispFilter]);

  if (!data)
    return (
      <aside className="emic-dock emic-dock-right" style={{ pointerEvents: "none" }}>
        <div className="dock-head">
          <h3>即時派遣</h3>
          <div className="note">連線中…</div>
        </div>
        <TableSkeleton />
      </aside>
    );

  const s = data.summary;
  const sc = data.statusCounts || {
    all: s.activeDispatches,
    5: s.status5,
    6: s.status6,
    7: s.status7,
    8: s.status8,
  };

  let list: LiveUnit[] = data.liveUnits || data.dispatches || [];
  if (dispFilter)
    list = list.filter((x) => String(x.statusId) === dispFilter);

  const note =
    data.dataNote ||
    `派遣≤${data.filters?.dispatchMaxMin ?? 180}分 · GPS即時≤${data.filters?.gpsLiveMin ?? 30}分`;

  function selectAmb(x: LiveUnit) {
    if (!x.ambulanceCode) return;
    setSelectedAmb(x.ambulanceCode);
    useEmicStore.getState().pauseMap(8000);
    setMobileView("map");
  }

  const filters: { key: DispFilter; label: string; count: number; color?: string }[] = [
    { key: "", label: "全部", count: sc.all ?? s.activeDispatches ?? 0 },
    { key: "5", label: "已派遣", count: sc[5] ?? 0, color: "#ca8a04" },
    { key: "6", label: "已出發", count: sc[6] ?? 0, color: "#ea580c" },
    { key: "7", label: "已到達", count: sc[7] ?? 0, color: "#2563eb" },
    { key: "8", label: "執行中", count: sc[8] ?? 0, color: "#16a34a" },
  ];

  return (
    <aside className={`emic-dock emic-dock-right ${mobileView === "right" ? "active" : ""}`}>
      <div className="dock-head">
        <h3>
          即時派遣
          <span className="count">{s.activeDispatches ?? list.length}</span>
        </h3>
        <div className="note">
          {note} · {data.pollInterval || 8}秒更新
        </div>
        <div className="disp-filters">
          {filters.map((f) => (
            <button
              key={f.key || "all"}
              type="button"
              className={dispFilter === f.key ? "on" : ""}
              onClick={() => setDispFilter(f.key)}
            >
              {f.color && (
                <span
                  className="sdot"
                  style={{ background: f.color }}
                />
              )}
              {f.label}
              <span className="fc">{f.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="disp-table-wrap emic-scroll">
        <table className="disp-table">
          <thead>
            <tr>
              <th>車組 / 分隊</th>
              <th>狀態</th>
              <th className="num">派遣</th>
              <th>GPS</th>
            </tr>
          </thead>
          <tbody>
            {list.length ? (
              list.map((x) => {
                const gpsTxt =
                  x.gpsAgeMin != null ? (
                    x.gpsLive ? (
                      <span className="gps-fresh">{x.gpsAgeMin}分</span>
                    ) : (
                      <span className="gps-stale">{x.gpsAgeMin}分</span>
                    )
                  ) : (
                    "—"
                  );
                const dispT = x.dispatchedAt
                  ? fmt(x.dispatchedAt)
                  : x.ageMin != null
                    ? x.ageMin + "分"
                    : "—";
                const addrHint =
                  (emicFeatures.gpsCases ? x.gpsCaseAddress : null) ||
                  x.epcrAddress ||
                  x.realAddress ||
                  "";
                const sel = selectedAmb && selectedAmb === x.ambulanceCode;
                const rowKey = x.uuid || x.ambulanceCode;
                return (
                  <tr
                    key={rowKey}
                    className={`${flashing.has(rowKey) ? "row-flash" : ""}${sel ? " row-selected" : ""}`}
                    onClick={() => selectAmb(x)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        selectAmb(x);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label={`${x.ambulanceCode || "救護車"} ${x.branch || ""} ${x.statusName || ""}，點擊在地圖定位`}
                    aria-pressed={sel}
                  >
                    <td>
                      <b>{esc(x.ambulanceCode) || "—"}</b>
                      {x.hasLiveVideo ? (
                        <Video
                          size={12}
                          style={{
                            color: "var(--epcr)",
                            verticalAlign: "-1px",
                            marginLeft: 3,
                          }}
                        />
                      ) : null}
                      <br />
                      <small style={{ color: "var(--muted)" }}>
                        {esc(x.branch) || "—"}
                      </small>
                      {addrHint ? (
                        <>
                          <br />
                          <small
                            className="addr"
                            title={esc(addrHint)}
                          >
                            {esc(addrHint.slice(0, 18))}
                          </small>
                        </>
                      ) : x.lat && emicFeatures.geocode ? (
                        <>
                          <br />
                          <small className="addr" title="點擊反查完整地址">
                            📍 可反查
                          </small>
                        </>
                      ) : null}
                    </td>
                    <td>
                      <span
                        dangerouslySetInnerHTML={{
                          __html: `<span class="status-pill s${x.statusId}">${esc(x.statusName)}</span>`,
                        }}
                      />
                    </td>
                    <td className="num">{dispT}</td>
                    <td>{gpsTxt}</td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={4} className="empty">
                  目前無即時派遣
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {emicFeatures.kml ? (
      <div className="emic-kml-dock">
        <div className="emic-kml-dock-head">
          <h4>
            <TriangleAlert size={14} /> EMIC 災情對照
            <span className="count">{emicKml?.summary?.shown ?? 0}</span>
          </h4>
          <button
            type="button"
            className="emic-kml-expand"
            onClick={() => {
              setLeftPane("new");
              setMobileView("left");
            }}
          >
            展開
          </button>
        </div>
        <EmicKmlFilters />
        <div className="emic-kml-dock-list emic-scroll">
          <EmicKmlList compact />
        </div>
      </div>
      ) : null}
    </aside>
  );
}
