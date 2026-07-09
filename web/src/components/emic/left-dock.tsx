"use client";

import { useEmicStore } from "@/lib/emic/store";
import { EmicKmlList } from "@/components/emic/emic-kml-list";
import { EmicKmlFilters } from "@/components/emic/emic-kml-filters";
import { emicKmlRegionActive } from "@/lib/emic/kml-shared";
import { fmt, esc, statusPill } from "@/lib/emic/format";
import { emicFeatures } from "@/lib/emic/features";
import type { GpsCase, NewCase, Vitals } from "@/lib/emic/types";
import { DockSkeleton } from "./skeletons";
import { CaseCountdown } from "./case-countdown";
import {
  Bell,
  Activity,
  HeartPulse,
  MoreHorizontal,
  Radio,
  MapPin,
  Video,
  FileText,
  Building2,
  TriangleAlert,
} from "lucide-react";

export function LeftDock() {
  const data = useEmicStore((s) => s.data);
  const emicKml = useEmicStore((s) => s.emicKml);
  const emicRegion = useEmicStore((s) => s.emicRegion);
  const setOpenCaseId = useEmicStore((s) => s.setOpenCaseId);
  const mobileView = useEmicStore((s) => s.mobileView);
  const pane = useEmicStore((s) => s.leftPane);
  const setPane = useEmicStore((s) => s.setLeftPane);
  const setSelectedAmb = useEmicStore((s) => s.setSelectedAmb);
  const setMobileView = useEmicStore((s) => s.setMobileView);

  if (!data)
    return (
      <aside className="emic-dock emic-dock-left" style={{ pointerEvents: "none" }}>
        <DockSkeleton />
      </aside>
    );

  const s = data.summary;
  const k = data.edtKpi;

  const emicN = emicFeatures.kml
    ? emicKmlRegionActive(emicKml, emicRegion)
    : 0;
  const gpsCases = emicFeatures.gpsCases ? data.gpsCases || [] : [];
  const newPaneN =
    (data.newCases || []).length +
    gpsCases.length +
    (emicFeatures.kml ? (emicKml?.summary?.shown ?? 0) : 0);
  const sortedNewCases = [...(data.newCases || [])].sort((a, b) =>
    (b.dispatchedAt || "").localeCompare(a.dispatchedAt || ""),
  );
  const quick = [
    { l: "出勤", v: s.activeDispatches, hot: true, click: undefined as (() => void) | undefined },
    { l: "GPS", v: s.gpsLive, hot: true, click: undefined },
    {
      l: "新案",
      v: newPaneN,
      hot: s.newCasesThisPoll > 0 || emicN > 0 || (s.gpsCases ?? 0) > 0,
      click: () => setPane("new"),
    },
    ...(emicFeatures.gpsCases
      ? [
          {
            l: "GPS案",
            v: s.gpsCases ?? gpsCases.length,
            hot: (s.gpsCases ?? gpsCases.length) > 0,
            click: () => setPane("new"),
          },
        ]
      : []),
  ];

  return (
    <aside className={`emic-dock emic-dock-left ${mobileView === "left" ? "active" : ""}`}>
      <div className="quick-strip">
        {quick.map((q) => (
          <div
            className={`q${q.click ? " q-click" : ""}`}
            key={q.l}
            onClick={q.click}
            role={q.click ? "button" : undefined}
            tabIndex={q.click ? 0 : undefined}
          >
            <div className={`qv ${q.hot ? "hot emic-hot" : ""}`}>{q.v ?? 0}</div>
            <div className="ql">{q.l}</div>
          </div>
        ))}
      </div>

      <div className="left-tabs">
        <button
          type="button"
          className={`left-tab ${pane === "new" ? "on" : ""}`}
          onClick={() => setPane("new")}
        >
          <Bell size={12} style={{ verticalAlign: "-1px", marginRight: 3 }} />
          新案
        </button>
        <button
          type="button"
          className={`left-tab ${pane === "stats" ? "on" : ""}`}
          onClick={() => setPane("stats")}
        >
          <Activity size={12} style={{ verticalAlign: "-1px", marginRight: 3 }} />
          統計
        </button>
        <button
          type="button"
          className={`left-tab ${pane === "vitals" ? "on" : ""}`}
          onClick={() => setPane("vitals")}
        >
          <HeartPulse size={12} style={{ verticalAlign: "-1px", marginRight: 3 }} />
          徵象
        </button>
        <button
          type="button"
          className={`left-tab ${pane === "more" ? "on" : ""}`}
          onClick={() => setPane("more")}
        >
          <MoreHorizontal size={12} style={{ verticalAlign: "-1px", marginRight: 3 }} />
          更多
        </button>
      </div>

      {/* ── 新案件（EPCR + EMIC 災情）── */}
      <div
        className={`left-pane emic-scroll ${pane === "new" ? "on" : ""}`}
      >
        <div className="pane-title">
          <Bell size={13} /> 新案件 / 告警
          <span className="count">{newPaneN}</span>
        </div>
        {sortedNewCases.length ? (
          (sortedNewCases as NewCase[]).map((c, i) => {
            const id = c.uuid || c.recordUuid || "";
            return (
              <div
                className="new-item"
                key={id || i}
                onClick={() => id && setOpenCaseId(id)}
              >
                <div className="new-item-head">
                  <b>{c.ambulanceCode || (c.caseType === "vitals" ? "生命徵象" : "新案件")}</b>
                  <CaseCountdown
                    firstSeenAt={c.firstSeenAt}
                    initialSec={c.retainSecLeft}
                    compact
                  />
                </div>
                {c.branch ? <span>{c.branch} </span> : null}
                <small>
                  {c.statusName || (c.caseType === "vitals" ? "新徵象" : "派遣")} ·{" "}
                  {c.ageMin ?? "?"} 分鐘前
                  {c.dispatchedAt ? ` · ${fmt(c.dispatchedAt)}` : ""}
                  {c.lastSeen ? ` · ${fmt(c.lastSeen)}` : ""}
                </small>
              </div>
            );
          })
        ) : (
          <div className="empty">持續監控中，尚無新案件</div>
        )}

        {emicFeatures.gpsCases && gpsCases.length > 0 ? (
          <>
            <div
              className="pane-title"
              style={{ marginTop: sortedNewCases.length ? 14 : 0 }}
            >
              <MapPin size={13} /> 救護車 GPS 案件
              <span className="count">{gpsCases.length}</span>
            </div>
            {gpsCases.map((c: GpsCase) => {
              const triggerLabel =
                c.trigger === "arrived"
                  ? "到達現場"
                  : c.trigger === "gps_stale"
                    ? "GPS 停駐"
                    : "現場定位";
              return (
                <div
                  className="gps-case-item"
                  key={c.uuid}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (c.ambulanceCode) setSelectedAmb(c.ambulanceCode);
                    setMobileView("map");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      if (c.ambulanceCode) setSelectedAmb(c.ambulanceCode);
                      setMobileView("map");
                    }
                  }}
                >
                  <div className="gps-case-head">
                    <b>{c.ambulanceCode || "—"}</b>
                    <span
                      dangerouslySetInnerHTML={{
                        __html: statusPill(c.statusId, c.statusName),
                      }}
                    />
                  </div>
                  <div className="gps-case-addr">{c.geocodedAddress || "反查中…"}</div>
                  <small>
                    {triggerLabel}
                    {c.branch ? ` · ${c.branch}` : ""}
                    {c.isStale ? " · GPS 停駐" : ""}
                    {c.gpsAgeMin != null ? ` · ${c.gpsAgeMin} 分前` : ""}
                  </small>
                  {c.epcrAddress ? (
                    <small className="gps-case-epcr" title="EPCR 案件地址">
                      EPCR：{c.epcrAddress}
                    </small>
                  ) : null}
                </div>
              );
            })}
          </>
        ) : null}

        {(data.alerts || []).length > 0 && (
          <>
            <div className="pane-title" style={{ marginTop: sortedNewCases.length ? 14 : 0 }}>
              <Bell size={13} /> 即時告警
              <span className="count">{(data.alerts || []).length}</span>
            </div>
            {(data.alerts || []).slice(0, 8).map((a, i) => {
              const m = a.msg.match(
                /^狀態變更\s+(.+?):\s+(.+?)\s*→\s*(.+)$/,
              );
              const cls =
                a.type === "status_change"
                  ? "status"
                  : a.type === "emic_kml"
                    ? "new"
                    : a.type === "new_case" || a.type === "new_vitals"
                      ? "new"
                      : a.type === "live_video"
                        ? "video"
                        : "";
              return (
                <div className={`alert-item ${cls}`} key={i}>
                  <Bell size={13} />
                  {m ? (
                    <>
                      狀態變更 <b>{m[1]}</b>{" "}
                      <span
                        dangerouslySetInnerHTML={{
                          __html: statusPill(
                            { 已派遣: 5, 已出發: 6, 已到達: 7, "執行中(有影像)": 8 }[
                              m[2].trim()
                            ] as number,
                            m[2].trim(),
                          ),
                        }}
                      />
                      <span className="alert-arrow">→</span>
                      <span
                        dangerouslySetInnerHTML={{
                          __html: statusPill(
                            { 已派遣: 5, 已出發: 6, 已到達: 7, "執行中(有影像)": 8 }[
                              m[3].trim()
                            ] as number,
                            m[3].trim(),
                          ),
                        }}
                      />
                    </>
                  ) : (
                    a.msg
                  )}
                </div>
              );
            })}
          </>
        )}

        {emicFeatures.kml ? (
          <>
            <div className="pane-title emic-pane-title" style={{ marginTop: 14 }}>
              <TriangleAlert size={13} /> EMIC 災情通報
              <span className="count">{emicKml?.summary?.shown ?? 0}</span>
            </div>
            <div className="emic-kml-note">
              {emicKml
                ? `高雄處理中 ${emicKml.summary.kaohsiungActive ?? 0} · 新北 ${emicKml.summary.ntpcActive} · 全國 ${emicKml.summary.total} · 更新 ${fmt(emicKml.updatedAt)}`
                : "載入中…"}
            </div>
            <EmicKmlFilters showMapToggle />
            <EmicKmlList />
          </>
        ) : null}
      </div>

      {/* ── 統計 ── */}
      <div
        className={`left-pane emic-scroll ${pane === "stats" ? "on" : ""}`}
      >
        <div className="pane-title">
          <Activity size={13} /> 即時統計
        </div>
        <div className="stat-grid">
          <div className="stat-item">
            <div className="v hot">{s.activeDispatches ?? 0}</div>
            <div className="l">即時出勤</div>
          </div>
          <div className="stat-item">
            <div className="v hot">{s.gpsLive ?? 0}</div>
            <div className="l">即時 GPS</div>
          </div>
          <div className="stat-item">
            <div className="v hot">{s.newCasesThisPoll ?? 0}</div>
            <div className="l">新案件</div>
          </div>
          <div className="stat-item">
            <div className="v">{s.liveVideoCases ?? 0}</div>
            <div className="l">即時影像</div>
          </div>
        </div>

        {emicFeatures.edt ? (
          <>
        <div className="pane-title">
          <Radio size={13} /> E點通 KPI
          <span className="count">{data.pollInterval || 8}秒</span>
        </div>
        <div className="edt-today">
          <div className="item">
            <div className="v">{k.caseSampleSize ?? "—"}</div>
            <div className="l">今日案件</div>
          </div>
          <div className="item">
            <div className="v" style={{ fontSize: 14 }}>
              {k.avgReactionTime ?? "—"}
            </div>
            <div className="l">平均反應</div>
          </div>
          <div className="item">
            <div className="v" style={{ fontSize: 14 }}>
              {k.avgWorkTime ?? "—"}
            </div>
            <div className="l">平均作業</div>
          </div>
        </div>
        <PctBar
          cls="veh"
          pct={k.vehicleUsagePct}
          sub={`車輛使用率 ${k.ambulanceWorking ?? "—"}/${k.ambulanceSum ?? "—"}`}
        />
        <PctBar
          cls="br"
          pct={k.branchUsagePct}
          sub={`分隊使用率 ${k.branchWorking ?? "—"}/${k.branchSum ?? "—"}`}
        />
        <PctBar
          cls="avail"
          pct={k.availability}
          sub={`救護車妥善率 ${
            k.prCarUseSum != null
              ? k.prCarUseSum + "/" + (k.prCarSum ?? "—") + " 可用"
              : ""
          }`}
        />

        <div className="pane-title" style={{ marginTop: 14 }}>
          <Building2 size={13} /> 分隊執行量
          <span className="count">{(data.edtBranches || []).length}</span>
        </div>
        {(data.edtBranches || []).length ? (
          <table className="branch-table">
            <thead>
              <tr>
                <th>分隊</th>
                <th>行政區</th>
                <th className="num">車輛</th>
                <th className="num">執行</th>
              </tr>
            </thead>
            <tbody>
              {(data.edtBranches || [])
                .slice(0, 30)
                .map((b) => (
                  <tr
                    key={b.name}
                    className={(b.dispatchSum || 0) > 0 ? "hot" : ""}
                  >
                    <td>
                      <b>{esc(b.name)}</b>
                    </td>
                    <td>{esc(b.district)}</td>
                    <td className="num">{b.ambulanceSum ?? "—"}</td>
                    <td className="num">{b.dispatchSum ?? 0}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">無分隊資料</div>
        )}
          </>
        ) : null}
      </div>

      {/* ── 徵象 ── */}
      <div
        className={`left-pane emic-scroll ${pane === "vitals" ? "on" : ""}`}
      >
        <div className="pane-title">
          <HeartPulse size={13} /> 生命徵象
          <span className="count">{(data.vitals || []).length}</span>
        </div>
        {(data.vitals || []).length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>車組</th>
                <th className="num">HR</th>
                <th className="num">SpO2</th>
                <th className="num">BP</th>
                <th>時間</th>
              </tr>
            </thead>
            <tbody>
              {(data.vitals || [])
                .slice(0, 20)
                .map((v: Vitals, i) => {
                  const hrHigh = v.hr != null && v.hr > 120;
                  const spo2Low = v.spo2 != null && v.spo2 < 90;
                  return (
                    <tr
                      key={v.recordUuid || i}
                      onClick={() => setOpenCaseId(v.recordUuid)}
                      style={{ cursor: "pointer" }}
                    >
                      <td>
                        <b>{v.CaseID?.slice(0, 6) || v.recordUuid.slice(0, 6)}</b>
                      </td>
                      <td
                        className="num"
                        style={{ color: hrHigh ? "#ef4444" : undefined, fontWeight: hrHigh ? 700 : undefined }}
                      >
                        {v.hr ?? "—"}
                      </td>
                      <td
                        className="num"
                        style={{ color: spo2Low ? "#ef4444" : undefined, fontWeight: spo2Low ? 700 : undefined }}
                      >
                        {v.spo2 ?? "—"}
                      </td>
                      <td className="num">{v.NBPm ?? "—"}</td>
                      <td>{v.ageMin}分</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        ) : (
          <div className="empty">尚無生命徵象資料</div>
        )}
      </div>

      {/* ── 更多 ── */}
      <div
        className={`left-pane emic-scroll ${pane === "more" ? "on" : ""}`}
      >
        <div className="pane-title">
          <FileText size={13} /> 事件紀錄
          <span className="count">{(data.events || []).length}</span>
        </div>
        {(data.events || []).length ? (
          (data.events || [])
            .slice(0, 10)
            .map((e, i) => (
              <div className="evt-item" key={i}>
                <b>{fmt(e.Timestamp)}</b> · {esc(e.EventType || "事件")}
              </div>
            ))
        ) : (
          <div className="empty">尚無事件</div>
        )}

        <div className="pane-title" style={{ marginTop: 14 }}>
          <Video size={13} /> 影像紀錄
          <span className="count">{(data.images || []).length}</span>
        </div>
        {(data.images || []).length ? (
          (data.images || [])
            .slice(0, 8)
            .map((img, i) => (
              <div
                className="img-item"
                key={img.id || i}
                onClick={() => setOpenCaseId(img.recordUuid)}
              >
                <a
                  href={img.download || "#"}
                  target="_blank"
                  rel="noopener"
                  onClick={(e) => e.stopPropagation()}
                >
                  {esc(img.fileName || "影像")}
                </a>
                <br />
                <small>{fmt(img.createdAt)}</small>
              </div>
            ))
        ) : (
          <div className="empty">尚無影像</div>
        )}

        <div className="pane-title" style={{ marginTop: 14 }}>
          <MapPin size={13} /> 資料說明
        </div>
        <div
          style={{
            fontSize: 11.5,
            color: "var(--muted)",
            lineHeight: 1.7,
            background: "rgba(255,255,255,0.03)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "8px 10px",
          }}
        >
          {esc(data.dataNote)}
          <br />
          輪詢間隔：{data.pollInterval || 8} 秒
          <br />
          過濾條件：派遣 ≤ {data.filters?.dispatchMaxMin ?? 180} 分 · GPS 即時 ≤{" "}
          {data.filters?.gpsLiveMin ?? 30} 分
        </div>
      </div>
    </aside>
  );
}

function PctBar({
  cls,
  pct,
  sub,
}: {
  cls: string;
  pct: number | null | undefined;
  sub: string;
}) {
  const v = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <div className="edt-meter">
      <div className="row">
        <span>{sub}</span>
        <span className="pct">{pct != null ? v + "%" : "—"}</span>
      </div>
      <div className={`edt-bar ${cls}`}>
        <i style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}
