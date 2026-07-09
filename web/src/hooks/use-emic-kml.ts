"use client";

import { useEffect } from "react";
import { useEmicStore } from "@/lib/emic/store";
import { emicFeatures } from "@/lib/emic/features";
import type { EmicKmlResponse } from "@/lib/emic/types";

/** 比後端 poll（90s）更頻繁，確保 UI 跟得上 */
const POLL_MS = 30_000;

/** 登入後輪詢 EMIC KML */
export function useEmicKmlPoll() {
  const emicRegion = useEmicStore((s) => s.emicRegion);
  const emicActiveOnly = useEmicStore((s) => s.emicActiveOnly);
  const setEmicKml = useEmicStore((s) => s.setEmicKml);

  useEffect(() => {
    if (!emicFeatures.kml) {
      setEmicKml(null);
      return;
    }
    let cancelled = false;

    async function load() {
      const q = new URLSearchParams();
      q.set("region", emicRegion);
      if (emicActiveOnly) q.set("active", "1");
      try {
        const r = await fetch(`/api/emic/kml?${q}&_=${Date.now()}`, {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (cancelled) return;
        if (r.status === 401) {
          setEmicKml(null);
          return;
        }
        if (!r.ok) return;
        const d = (await r.json()) as EmicKmlResponse;
        if (!cancelled) setEmicKml(d);
      } catch {
        /* keep last data */
      }
    }

    load();
    const t = setInterval(load, POLL_MS);

    function onVisible() {
      if (document.visibilityState === "visible") load();
    }
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [emicRegion, emicActiveOnly, setEmicKml]);
}