"use client";

import { useEffect, useState } from "react";
import { useEmicStore } from "@/lib/emic/store";
import { fmt, esc } from "@/lib/emic/format";
import type { CaseDetail } from "@/lib/emic/types";
import { LiveVideo } from "@/components/emic/live-video";
import { X, HeartPulse, ListChecks, Activity, Video } from "lucide-react";

type Tab = "vitals" | "events" | "ecg" | "video";

export function CaseModal() {
  const openCaseId = useEmicStore((s) => s.openCaseId);
  const setOpenCaseId = useEmicStore((s) => s.setOpenCaseId);

  if (!openCaseId) return null;

  return (
    <CaseModalInner
      key={openCaseId}
      id={openCaseId}
      onClose={() => setOpenCaseId(null)}
    />
  );
}

function CaseModalInner({ id, onClose }: { id: string; onClose: () => void }) {
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("vitals");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/emic/case?id=${encodeURIComponent(id)}`, {
      credentials: "same-origin",
    })
      .then((r) => r.json())
      .then((d: CaseDetail) => {
        if (!cancelled) {
          setDetail(d);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const titleId = id.length > 12 ? id.slice(0, 8) + "…" : id;

  return (
    <div
      id="emic-modal"
      className="open"
      role="dialog"
      aria-modal="true"
      aria-labelledby="emic-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-box">
        <div className="mhead">
          <h2 id="emic-modal-title">案件詳情 · {titleId}</h2>
          <button
            type="button"
            className="close"
            onClick={onClose}
            aria-label="關閉"
          >
            <X size={16} />
          </button>
        </div>
        <div className="modal-tabs">
          <TabBtn tab={tab} setTab={setTab} t="vitals" icon={<HeartPulse size={13} />} label="生命徵象" />
          <TabBtn tab={tab} setTab={setTab} t="events" icon={<ListChecks size={13} />} label="事件" />
          <TabBtn tab={tab} setTab={setTab} t="ecg" icon={<Activity size={13} />} label="心電/AI" />
          <TabBtn tab={tab} setTab={setTab} t="video" icon={<Video size={13} />} label="即時影像" />
        </div>
        <div className="modal-body emic-scroll">
          {loading ? (
            <div className="empty">載入中…</div>
          ) : !detail ? (
            <div className="empty">無案件資料</div>
          ) : tab === "vitals" ? (
            <VitalsTab detail={detail} />
          ) : tab === "events" ? (
            <EventsTab detail={detail} />
          ) : tab === "ecg" ? (
            <EcgTab detail={detail} />
          ) : (
            <VideoTab id={id} detail={detail} />
          )}
        </div>
      </div>
    </div>
  );
}

function TabBtn({
  tab,
  setTab,
  t,
  icon,
  label,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  t: Tab;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      className={`mtab ${tab === t ? "on" : ""}`}
      onClick={() => setTab(t)}
    >
      <span style={{ verticalAlign: "-2px", marginRight: 4 }}>{icon}</span>
      {label}
    </button>
  );
}

function VitalsTab({ detail }: { detail: CaseDetail }) {
  const t = detail.trendings || [];
  if (!t.length) return <div className="empty">尚無生命徵象資料</div>;
  const latest = t[0];
  return (
    <>
      <div className="vitals-mini-grid">
        <div className="vitals-mini">
          <div className="vv">{latest.hr ?? "—"}</div>
          <div className="vl">HR (bpm)</div>
        </div>
        <div className="vitals-mini">
          <div className="vv">{latest.spo2 ?? "—"}</div>
          <div className="vl">SpO2 (%)</div>
        </div>
        <div className="vitals-mini">
          <div className="vv">{latest.NBPm ?? "—"}</div>
          <div className="vl">BP 收縮</div>
        </div>
        <div className="vitals-mini">
          <div className="vv">{latest.respRate ?? "—"}</div>
          <div className="vl">呼吸</div>
        </div>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>時間</th>
            <th className="num">HR</th>
            <th className="num">SpO2</th>
            <th className="num">BP</th>
            <th className="num">呼吸</th>
            <th className="num">體溫</th>
          </tr>
        </thead>
        <tbody>
          {t.slice(0, 20).map((x, i) => (
            <tr key={i}>
              <td>{fmt(x.createdAt)}</td>
              <td className="num">{x.hr ?? "—"}</td>
              <td className="num">{x.spo2 ?? "—"}</td>
              <td className="num">
                {x.NBPs ?? "—"}/{x.NBPm ?? "—"}/{x.NBPd ?? "—"}
              </td>
              <td className="num">{x.respRate ?? "—"}</td>
              <td className="num">{x.temperature ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function EventsTab({ detail }: { detail: CaseDetail }) {
  const ev = detail.events || [];
  if (!ev.length) return <div className="empty">尚無事件紀錄</div>;
  return (
    <ul>
      {ev.slice(0, 15).map((e, i) => (
        <li key={i}>
          <b>{fmt(e.Timestamp)}</b> · {esc(e.EventType)}
        </li>
      ))}
    </ul>
  );
}

function EcgTab({ detail }: { detail: CaseDetail }) {
  const ecg = detail.aiEcg || [];
  const imgs = detail.images || [];
  if (!ecg.length && !imgs.length)
    return <div className="empty">尚無心電/AI 分析資料</div>;
  return (
    <>
      {ecg.map((r, i) => (
        <div className="ecg-card" key={i}>
          <div>
            <b>AI 心電分析</b> · 信心度{" "}
            <span className="res">{Math.round(r.confidence * 100)}%</span>
          </div>
          <div style={{ marginTop: 4, color: "var(--muted)" }}>
            {esc(r.result)}
          </div>
          <small style={{ color: "var(--muted-2)" }}>{fmt(r.createdAt)}</small>
        </div>
      ))}
      {imgs.map((img, i) => (
        <div className="ecg-card" key={`i${i}`}>
          <a
            href={img.url}
            target="_blank"
            rel="noopener"
            style={{ color: "var(--epcr)" }}
          >
            {esc(img.fileName)}
          </a>
          <br />
          <small style={{ color: "var(--muted-2)" }}>{fmt(img.createdAt)}</small>
        </div>
      ))}
    </>
  );
}

function VideoTab({ id, detail }: { id: string; detail: CaseDetail }) {
  if (!detail.hasStream) {
    return <div className="empty">此案件目前無即時影像</div>;
  }
  return <LiveVideo streamId={id} height={320} />;
}
