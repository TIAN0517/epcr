"use client";

import { useEffect, useState } from "react";
import { useEmicStore, type NotifyState } from "@/lib/emic/store";
import { emicKmlRegionActive } from "@/lib/emic/kml-shared";
import { fmt } from "@/lib/emic/format";
import { emicFeatures } from "@/lib/emic/features";
import {
  Activity,
  Video,
  LogOut,
  Radio,
  AlertTriangle,
  Bell,
  BellOff,
} from "lucide-react";

function clockParts(d = new Date()) {
  return {
    time: d.toLocaleTimeString("zh-TW", { hour12: false }),
    date: d.toLocaleDateString("zh-TW"),
  };
}

export function Topbar({ onLogout }: { onLogout: () => void }) {
  const data = useEmicStore((s) => s.data);
  const connError = useEmicStore((s) => s.connError);
  const failCount = useEmicStore((s) => s.failCount);
  const setVideoWallOpen = useEmicStore((s) => s.setVideoWallOpen);
  const emicKml = useEmicStore((s) => s.emicKml);
  const emicRegion = useEmicStore((s) => s.emicRegion);
  const setLeftPane = useEmicStore((s) => s.setLeftPane);
  const setMobileView = useEmicStore((s) => s.setMobileView);
  const notify = useEmicStore((s) => s.notify);
  const setNotify = useEmicStore((s) => s.setNotify);
  const [clock, setClock] = useState(() => clockParts());

  useEffect(() => {
    const t = setInterval(() => setClock(clockParts()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (typeof Notification === "undefined") {
      setNotify("unsupported");
      return;
    }
    setNotify(Notification.permission as NotifyState);
  }, [setNotify]);

  const liveVideoCount = data?.summary.liveVideoCases ?? 0;

  async function toggleNotify() {
    if (notify === "unsupported") return;
    if (notify === "granted") {
      setNotify("denied");
      return;
    }
    try {
      const perm = await Notification.requestPermission();
      setNotify(perm as NotifyState);
    } catch {
      setNotify("denied");
    }
  }

  const notifyLabel =
    notify === "granted"
      ? "通知開啟"
      : notify === "denied"
        ? "通知關閉"
        : notify === "unsupported"
          ? "不支援通知"
          : "啟用通知";

  const statusLabel = connError
    ? `連線中斷${failCount > 0 ? ` (${failCount})` : ""}`
    : data?.tokenOk === false
      ? "Token 失效"
      : "即時監控中";

  const statusClass = connError || data?.tokenOk === false ? "warn" : "live";

  return (
    <header className="emic-topbar" role="banner" data-build="20260708-topbar-u5">
      <div className="tb-brand">
        <img src="/bird50.png" alt="" width={34} height={34} className="tb-logo" />
        <div className="tb-brand-stack">
          <div className="tb-title">
            <span className="brand-full">EMIC 智慧雲端動態救護儀表板</span>
            <span className="brand-short">EMIC 救護儀表板</span>
          </div>
          <div className="tb-meta" aria-live="off">
            <span className="tb-time">{clock.time}</span>
            <span className="tb-meta-sep">·</span>
            <span className="tb-date">{clock.date}</span>
            <span className="tb-meta-sep tb-hide-sm">·</span>
            <span className="tb-sync tb-hide-sm">
              {data ? `更新 ${fmt(data.updatedAt)}` : "連線中…"}
            </span>
          </div>
        </div>
      </div>

      <div className="tb-right">
        <span className={`tb-chip ${statusClass}`} role="status">
          {statusClass === "live" ? (
            <Activity size={13} />
          ) : (
            <AlertTriangle size={13} />
          )}
          <span className="chip-text">{statusLabel}</span>
        </span>
        <button
          type="button"
          className={`tb-btn ${notify === "granted" ? "on" : ""}`}
          onClick={toggleNotify}
          title={notifyLabel}
          aria-label={notifyLabel}
          aria-pressed={notify === "granted"}
          disabled={notify === "unsupported"}
        >
          {notify === "granted" ? <Bell size={14} /> : <BellOff size={14} />}
          <span className="btn-text">通知</span>
        </button>
        {emicFeatures.kml ? (
          <button
            type="button"
            className="tb-btn emic-top-btn on"
            onClick={() => {
              setLeftPane("new");
              setMobileView("left");
            }}
            title="EMIC 災情 KML 對照"
            aria-label={`災情通報 ${emicKmlRegionActive(emicKml, emicRegion)} 件處理中`}
          >
            <AlertTriangle size={14} />
            <span className="btn-text">災情</span>
            {emicKml ? (
              <span className="emic-top-badge">
                {emicKmlRegionActive(emicKml, emicRegion)}
              </span>
            ) : null}
          </button>
        ) : null}
        <button
          type="button"
          className="tb-btn"
          onClick={() => setVideoWallOpen(true)}
          title="即時影像監看牆"
          aria-label={`影像牆${liveVideoCount > 0 ? `，${liveVideoCount} 路即時影像` : ""}`}
        >
          <Video size={14} />
          <span className="btn-text">
            影像{liveVideoCount > 0 ? ` (${liveVideoCount})` : ""}
          </span>
        </button>
        <button
          type="button"
          className="tb-btn"
          onClick={onLogout}
          title="登出"
          aria-label="登出"
        >
          <LogOut size={14} />
          <span className="btn-text">登出</span>
        </button>
      </div>
    </header>
  );
}