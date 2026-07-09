"use client";

import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import {
  useEmicStore,
  effectivePollMs,
  alertSig,
  NOTIFY_ALERT_TYPES,
} from "@/lib/emic/store";
import type { Alert, DashboardData, NewCase } from "@/lib/emic/types";
import { toast } from "@/hooks/use-toast";
import { caseKey, retainSecLeft } from "@/lib/emic/case-retain";
import { CaseRetainNotifyBody } from "./case-retain-notify";
import { Topbar } from "./topbar";
import { LeftDock } from "./left-dock";
import { RightDock } from "./right-dock";
import { AlertBar } from "./alert-bar";
import { MobileNav } from "./mobile-nav";
import { VideoWall } from "./video-wall";
import { CaseModal } from "./case-modal";
import { useEmicKmlPoll } from "@/hooks/use-emic-kml";

// Leaflet references `window` at import time, so the map must be loaded
// client-side only (ssr: false).
const MapView = dynamic(
  () => import("./map-view").then((m) => m.MapView),
  { ssr: false, loading: () => null },
);

declare global {
  interface Window {
    __emicMap?: { invalidateSize: () => void };
  }
}

export function Dashboard({ onLoggedOut }: { onLoggedOut: () => void }) {
  useEmicKmlPoll();
  const setData = useEmicStore((s) => s.setData);
  const setMobileView = useEmicStore((s) => s.setMobileView);
  const mobileView = useEmicStore((s) => s.mobileView);

  const tickingRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baseMsRef = useRef(8000);
  const stoppedRef = useRef(false);

  // ── Main polling loop with exponential backoff ──
  useEffect(() => {
    stoppedRef.current = false;

    async function tick() {
      if (tickingRef.current || stoppedRef.current) return;
      tickingRef.current = true;
      const st = useEmicStore.getState();
      try {
        const r = await fetch(`/api/emic/sync?_=${Date.now()}`, {
          credentials: "same-origin",
        });
        if (r.status === 401) {
          onLoggedOut();
          return;
        }
        const d = (await r.json()) as DashboardData & {
          authed?: boolean;
          error?: string;
        };
        if (d.authed === false || d.error === "unauthorized") {
          onLoggedOut();
          return;
        }
        setData(d);
        st.setConnError(false);
        st.resetFail();

        // Fire browser notifications for NEW alerts since last poll.
        maybeNotify(d.alerts || [], st.seenAlertSigs, st.notify, st.data === null);
        st.markAlertSeen((d.alerts || []).map(alertSig));

        // 新案件倒數計時 toast（保留 15 分鐘）
        maybeCaseRetainToast(
          d.newCases || [],
          st.seenCaseKeys,
          st.data === null,
        );
        st.markCasesSeen(
          (d.newCases || []).map(caseKey).filter(Boolean),
        );

        if (d.pollInterval) {
          baseMsRef.current = Math.max(8000, Number(d.pollInterval) * 1000);
        }
      } catch {
        st.setConnError(true);
        st.bumpFail();
      } finally {
        tickingRef.current = false;
        scheduleNext();
      }
    }

    function scheduleNext() {
      if (stoppedRef.current) return;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      const { failCount } = useEmicStore.getState();
      const ms = effectivePollMs(baseMsRef.current, failCount);
      pollTimerRef.current = setTimeout(tick, ms);
    }

    setMobileView("map");
    tick();

    return () => {
      stoppedRef.current = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  // ── Global keyboard shortcuts ──
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        const st = useEmicStore.getState();
        // Close modal first, then video wall, then clear selection.
        if (st.openCaseId) {
          st.setOpenCaseId(null);
          return;
        }
        if (st.videoWallOpen) {
          st.setVideoWallOpen(false);
          return;
        }
        if (st.selectedAmb) {
          st.setSelectedAmb("");
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // invalidate map size when switching back to map view (mobile)
  useEffect(() => {
    if (mobileView === "map") {
      const raf = requestAnimationFrame(() => {
        window.__emicMap?.invalidateSize();
        requestAnimationFrame(() => window.__emicMap?.invalidateSize());
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [mobileView]);

  async function handleLogout() {
    try {
      await fetch("/api/emic/logout", { credentials: "same-origin" });
    } catch {
      /* ignore */
    }
    onLoggedOut();
  }

  return (
    <div id="emic-app" data-mobile-view={mobileView}>
      {mobileView !== "map" ? (
        <button
          type="button"
          className="mobile-scrim"
          aria-label="關閉側欄，返回地圖"
          onClick={() => setMobileView("map")}
        />
      ) : null}
      <Topbar onLogout={handleLogout} />
      <AlertBar />
      <LeftDock />
      <RightDock />
      <MapView onReady={(m) => (window.__emicMap = m)} />
      <MobileNav />
      <VideoWall />
      <CaseModal />
    </div>
  );
}

/**
 * Fire desktop notifications for alerts that are (a) new since the last poll
 * and (b) of a notify-worthy type. On the very first poll we do NOT notify
 * (those are historical, not "new this instant").
 */
/** 新案件列入清單時，以倒數計時 toast 通知（保留 15 分鐘）。 */
function maybeCaseRetainToast(
  cases: NewCase[],
  seenKeys: Set<string>,
  isFirstPoll: boolean,
): void {
  if (isFirstPoll) return;
  for (const c of cases) {
    const key = caseKey(c);
    if (!key || seenKeys.has(key)) continue;
    const leftMs = retainSecLeft(c.firstSeenAt, c.retainSecLeft) * 1000;
    toast({
      title: `新案件 ${c.ambulanceCode || key.slice(0, 8)}`,
      description: (
        <CaseRetainNotifyBody
          ambulanceCode={c.ambulanceCode}
          branch={c.branch}
          statusName={c.statusName}
          firstSeenAt={c.firstSeenAt}
        />
      ),
      duration: Math.max(leftMs, 8000),
    });
  }
}

function maybeNotify(
  alerts: Alert[],
  seenSigs: Set<string>,
  notify: string,
  isFirstPoll: boolean,
): void {
  if (isFirstPoll) return;
  if (notify !== "granted") return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted")
    return;
  for (const a of alerts) {
    if (!NOTIFY_ALERT_TYPES.has(a.type)) continue;
    const sig = alertSig(a);
    if (seenSigs.has(sig)) continue;
    try {
      const n = new Notification("EMIC 救護告警", {
        body: a.msg,
        tag: sig,
        icon: "/bird50.png",
      });
      // Auto-close after 8 seconds so they don't pile up.
      setTimeout(() => n.close(), 8000);
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {
      /* Notification may throw in some browsers; ignore */
    }
  }
}
