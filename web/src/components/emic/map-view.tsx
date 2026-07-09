"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEmicStore } from "@/lib/emic/store";
import type { GpsPoint, LiveUnit, GeocodeResult, EmicKmlCase } from "@/lib/emic/types";
import {
  STATUS_CLS,
  STATUS_LABEL,
  fmt,
  esc,
  navUrls,
  pickFullAddress,
  compareAddrLines,
  isCoordText,
} from "@/lib/emic/format";
import { emicFeatures } from "@/lib/emic/features";

const GEO_CACHE_MAX = 120;

interface MapViewProps {
  onReady?: (map: L.Map) => void;
}

export function MapView({ onReady }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const clickLayerRef = useRef<L.LayerGroup | null>(null);
  const emicLayerRef = useRef<L.LayerGroup | null>(null);
  const emicMarkerIndexRef = useRef<Record<string, L.Marker>>({});
  const markerIndexRef = useRef<Record<string, L.Marker>>({});
  const markerSigRef = useRef<Record<string, string>>({});
  const gpsByCodeRef = useRef<Record<string, GpsPoint>>({});
  const geoCacheRef = useRef<Map<string, GeocodeResult>>(new Map());
  const mapFittedRef = useRef(false);
  const userMovedMapRef = useRef(false);
  const interactingRef = useRef(false);
  const pendingMarkerUpdateRef = useRef(false);
  const syncMarkersRef = useRef<() => void>(() => {});
  const readyRef = useRef(false);

  const data = useEmicStore((s) => s.data);
  const gpsFilter = useEmicStore((s) => s.gpsFilter);
  const setGpsFilter = useEmicStore((s) => s.setGpsFilter);
  const selectedAmb = useEmicStore((s) => s.selectedAmb);
  const setSelectedAmb = useEmicStore((s) => s.setSelectedAmb);
  const pauseMap = useEmicStore((s) => s.pauseMap);
  const mapPausedUntil = useEmicStore((s) => s.mapPausedUntil);
  const setMobileView = useEmicStore((s) => s.setMobileView);
  const emicKml = useEmicStore((s) => s.emicKml);
  const emicMapOn = useEmicStore((s) => s.emicMapOn);
  const setEmicMapOn = useEmicStore((s) => s.setEmicMapOn);
  const selectedEmicId = useEmicStore((s) => s.selectedEmicId);

  useEffect(() => {
    if (!emicFeatures.kml) setEmicMapOn(false);
  }, [setEmicMapOn]);

  // keep latest values for event handlers without rebinding
  const dataRef = useRef(data);
  dataRef.current = data;
  const selectedAmbRef = useRef(selectedAmb);
  selectedAmbRef.current = selectedAmb;

  // ── init map once ──
  useEffect(() => {
    if (readyRef.current || !containerRef.current) return;
    readyRef.current = true;

    const map = L.map("emic-map", {
      zoomControl: false,
      preferCanvas: true,
      attributionControl: true,
      inertia: true,
      inertiaDeceleration: 2800,
      easeLinearity: 0.22,
      zoomAnimation: true,
      fadeAnimation: true,
      markerZoomAnimation: false,
    }).setView([25.033, 121.565], 11);

    L.tileLayer(
      "https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}.png",
      {
        maxZoom: 18,
        minZoom: 8,
        keepBuffer: 6,
        updateWhenIdle: false,
        updateWhenZooming: true,
        attribution:
          '&copy; <a href="https://maps.nlsc.gov.tw/" target="_blank" rel="noopener">國土測繪中心</a>',
      },
    ).addTo(map);

    L.control.zoom({ position: "bottomright" }).addTo(map);
    markerLayerRef.current = L.layerGroup().addTo(map);
    emicLayerRef.current = L.layerGroup().addTo(map);
    clickLayerRef.current = L.layerGroup().addTo(map);

    const endInteraction = () => {
      window.setTimeout(() => {
        interactingRef.current = false;
        if (pendingMarkerUpdateRef.current) {
          pendingMarkerUpdateRef.current = false;
          syncMarkersRef.current();
        }
      }, 120);
    };
    map.on("dragstart zoomstart movestart", () => {
      interactingRef.current = true;
      userMovedMapRef.current = true;
    });
    map.on("dragend zoomend moveend", endInteraction);
    map.on("click", (e: L.LeafletMouseEvent) => {
      pauseMap(6000);
      const { lat, lng } = e.latlng;
      clickLayerRef.current?.clearLayers();
      const pin = L.marker([lat, lng], {
        icon: L.divIcon({
          className: "",
          html: '<div class="amb-marker s7" style="width:14px;height:14px;box-shadow:0 0 10px #42a5f5"></div>',
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        }),
      });
      pin.bindPopup(buildClickPopup(lat, lng), { maxWidth: 320 });
      clickLayerRef.current?.addLayer(pin);
      pin.openPopup();
    });
    map.on("popupopen", (e: L.LeafletPopupEvent) => {
      pauseMap(10000);
      // re-wire copy/nav actions whenever a popup opens (Leaflet rebuilds DOM).
      // Leaflet 1.9.4 exposes the source layer via the private `_source` prop.
      const src = (e.popup as L.Popup & { _source?: L.Layer })._source;
      const node = e.popup.getElement();
      if (node) wirePopupActions(node, src);
    });

    mapRef.current = map;
    onReady?.(map);

    const onResize = () => {
      window.clearTimeout((onResize as unknown as { t?: number }).t);
      (onResize as unknown as { t?: number }).t = window.setTimeout(
        () => map.invalidateSize(),
        150,
      );
    };
    window.addEventListener("resize", onResize, { passive: true });
    // invalidate after mount to fix initial sizing
    requestAnimationFrame(() => map.invalidateSize());

    return () => {
      window.removeEventListener("resize", onResize);
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
  }, []);

  // ── reverse geocode helper ──
  async function reverseGeocode(
    lat: number,
    lng: number,
  ): Promise<GeocodeResult | { error: string }> {
    if (!emicFeatures.geocode) {
      return { error: "地址反查已暫停" };
    }
    const key = `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
    const cached = geoCacheRef.current.get(key);
    if (cached) return cached;
    try {
      const r = await fetch(
        `/api/emic/geocode?lat=${lat}&lng=${lng}`,
        { credentials: "same-origin" },
      );
      if (!r.ok) throw new Error("http");
      const d = (await r.json()) as GeocodeResult;
      if (geoCacheRef.current.size >= GEO_CACHE_MAX) {
        const firstKey = geoCacheRef.current.keys().next().value;
        if (firstKey) geoCacheRef.current.delete(firstKey);
      }
      geoCacheRef.current.set(key, d);
      return d;
    } catch {
      return { error: "反查失敗" } as { error: string };
    }
  }

  function ambIcon(p: GpsPoint | LiveUnit): L.DivIcon {
    const stale = p.isStale ? " stale" : "";
    const cls = p.isStale ? "stale" : STATUS_CLS[p.statusId] || "s8";
    const code = esc(p.ambulanceCode || "—");
    return L.divIcon({
      className: "",
      html: `<div class="amb-pin"><div class="amb-marker ${cls}${stale}"></div><div class="amb-label">${code}</div></div>`,
      iconSize: [48, 36],
      iconAnchor: [24, 18],
    });
  }

  function markerSignature(p: GpsPoint | LiveUnit): string {
    return [p.lat, p.lng, p.statusId, p.isStale, p.ambulanceCode].join("|");
  }

  function setCopyAddrBtn(
    div: HTMLElement,
    g: GeocodeResult | { error?: string } | null,
  ) {
    const btn = div.querySelector<HTMLElement>(".pop-copy-addr");
    if (!btn) return;
    const addr = pickFullAddress(g);
    (div as HTMLElement & { _fullAddr?: string })._fullAddr = addr || "";
    if (addr) {
      btn.removeAttribute("disabled");
      btn.classList.add("on");
      btn.textContent = "複製完整地址";
    } else {
      btn.setAttribute("disabled", "disabled");
      btn.classList.remove("on");
      btn.textContent = (g as { error?: string })?.error
        ? "無完整地址"
        : "反查中…";
    }
  }

  function getPopupFullAddr(div: HTMLElement): string {
    const stored = (div as HTMLElement & { _fullAddr?: string })._fullAddr;
    if (stored) return stored;
    const revEl = div.querySelector<HTMLElement>(".pop-rev");
    const rev = revEl?.textContent?.trim() || "";
    if (rev && rev !== "—" && !isCoordText(rev) && !rev.includes("查詢中"))
      return rev;
    return "";
  }

  function copyCoords(lat: number, lng: number) {
    const t = `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
    navigator.clipboard?.writeText(t).catch(() => prompt("座標", t));
  }

  function copyFullAddressFromPopup(div: HTMLElement, btn: HTMLElement) {
    const t = getPopupFullAddr(div);
    if (!t) {
      const orig = btn.textContent;
      btn.textContent = "尚無完整地址";
      setTimeout(() => {
        btn.textContent = orig;
      }, 1200);
      return;
    }
    const done = () => {
      btn.textContent = "已複製 ✓";
      setTimeout(() => {
        btn.textContent = "複製完整地址";
      }, 1200);
    };
    navigator.clipboard?.writeText(t).then(done).catch(() => {
      if (prompt("完整地址", t) != null) done();
    });
  }

  function applyGeocodeToPopup(
    div: HTMLElement,
    g: GeocodeResult | { error?: string } | null,
    extra?: (rev: string, g: GeocodeResult | { error?: string } | null) => void,
  ) {
    const rev = pickFullAddress(g) || (g as { error?: string })?.error || "—";
    const el = div.querySelector<HTMLElement>(".pop-rev");
    if (el) el.textContent = rev;
    const nel = div.querySelector<HTMLElement>(".pop-nlsc");
    if (nel)
      nel.textContent =
        (g as GeocodeResult)?.nlscSect ||
        (g as GeocodeResult)?.nlsc ||
        "—";
    setCopyAddrBtn(div, g);
    extra?.(rev, g);
  }

  function wirePopupActions(node: HTMLElement, source: L.Layer | undefined) {
    const nav = node.querySelector<HTMLElement>(".nav-btns");
    const nlat = Number(nav?.dataset?.lat);
    const nlng = Number(nav?.dataset?.lng);
    const code = (source as (L.Layer & { _ambCode?: string }) | undefined)?._ambCode;

    nav
      ?.querySelector(".pop-copy-coords")
      ?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (Number.isFinite(nlat) && Number.isFinite(nlng))
          copyCoords(nlat, nlng);
      });

    node
      .querySelector(".pop-copy-addr")
      ?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const btn = e.currentTarget as HTMLElement;
        copyFullAddressFromPopup(node, btn);
      });

    // marker click → select ambulance
    if (code) {
      // already handled by marker.on('click'); nothing here
    }
  }

  function navButtonsHtml(lat: number, lng: number): string {
    const u = navUrls(lat, lng);
    return `<div class="nav-btns" data-lat="${lat}" data-lng="${lng}">
      <a href="${u.google}" target="_blank" rel="noopener">Google 導航</a>
      <a href="${u.apple}" target="_blank" rel="noopener">Apple 地圖</a>
      <a href="${u.osm}" target="_blank" rel="noopener">OSM 檢視</a>
      <button type="button" class="pop-copy-coords">複製座標</button>
    </div>`;
  }

  function buildAmbPopup(p: GpsPoint | LiveUnit): HTMLElement {
    const div = document.createElement("div");
    div.className = "map-popup";
    const ageCls = p.isStale ? "gps-stale" : "gps-fresh";
    const epcrAddr = (p as LiveUnit).epcrAddress || "（無）";
    const realAddr =
      (p as LiveUnit).realAddress &&
      (p as LiveUnit).realAddress !== (p as LiveUnit).epcrAddress
        ? (p as LiveUnit).realAddress
        : "";
    const caseId = (p as LiveUnit).caseId;
    const licenseNo = (p as LiveUnit).licenseNo || "";
    const branch = p.branch || "—";
    const statusName = p.statusName || STATUS_LABEL[p.statusId] || "—";
    const dispatchedAt = (p as LiveUnit).dispatchedAt;
    const gpsCaseAddr =
      emicFeatures.gpsCases && (p as LiveUnit).gpsCaseAddress
        ? (p as LiveUnit).gpsCaseAddress!
        : "";
    div.innerHTML = `<h4>${esc(p.ambulanceCode || "—")}</h4>
      <div>${esc(licenseNo)} · ${esc(branch)} · <b>${esc(statusName)}</b></div>
      <div>派遣 ${fmt(dispatchedAt)}${caseId ? " · 案號 " + esc(caseId) : ""}</div>
      <div class="addr-block"><label>GPS 即時座標</label>
        <div><span class="${ageCls}">${p.gpsAgeMin ?? "?"} 分前</span> · ${p.lat?.toFixed(5)}, ${p.lng?.toFixed(5)}</div></div>
      ${gpsCaseAddr ? `<div class="addr-block"><label>救護車 GPS 案件（自動反查）</label><div>${esc(gpsCaseAddr)}</div></div>` : ""}
      <div class="addr-block"><label>EPCR 案件地址</label><div>${esc(epcrAddr)}</div></div>
      ${realAddr ? `<div class="addr-block"><label>EPCR 實際地址</label><div>${esc(realAddr)}</div></div>` : ""}
      ${emicFeatures.geocode ? `<div class="addr-block addr-rev-block"><label>完整反查（Google）</label><div class="pop-rev">${esc(gpsCaseAddr) || "查詢中…"}</div>
        <button type="button" class="pop-copy-addr" ${gpsCaseAddr ? "" : "disabled"}>${gpsCaseAddr ? "複製完整地址" : "反查中…"}</button></div>
      <div class="addr-block"><label>NLSC 行政區</label><div class="pop-nlsc">查詢中…</div></div>
      <div class="pop-cmp" style="margin-top:6px;font-size:.78rem"></div>` : ""}
      ${navButtonsHtml(p.lat, p.lng)}`;
    if (gpsCaseAddr) {
      setCopyAddrBtn(div, { fullAddress: gpsCaseAddr });
      const nel = div.querySelector<HTMLElement>(".pop-nlsc");
      if (nel && (p as LiveUnit).gpsCaseNlsc)
        nel.textContent = (p as LiveUnit).gpsCaseNlsc!;
    }
    if (emicFeatures.geocode && p.lat != null && p.lng != null && !gpsCaseAddr) {
      reverseGeocode(p.lat, p.lng).then((g) => {
        applyGeocodeToPopup(div, g, (rev) => {
          const cel = div.querySelector<HTMLElement>(".pop-cmp");
          if (cel) {
            const cmp = compareAddrLines(
              (p as LiveUnit).epcrAddress,
              (p as LiveUnit).realAddress,
              rev,
              (g as GeocodeResult)?.nlsc || (g as GeocodeResult)?.nlscSect,
            );
            cel.innerHTML = `<span class="${cmp.cls}">${cmp.html}</span>`;
          }
        });
      });
    }
    return div;
  }

  function buildClickPopup(lat: number, lng: number): HTMLElement {
    const div = document.createElement("div");
    div.className = "map-popup";
    div.innerHTML = `<h4>地圖點選位置</h4>
      <div style="font-size:.78rem;color:var(--muted)">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
      ${emicFeatures.geocode ? `<div class="addr-block addr-rev-block"><label>完整反查（Google）</label><div class="pop-rev">查詢中…</div>
        <button type="button" class="pop-copy-addr" disabled>反查中…</button></div>
      <div class="addr-block"><label>NLSC 行政區</label><div class="pop-nlsc">查詢中…</div></div>` : ""}
      ${navButtonsHtml(lat, lng)}`;
    if (emicFeatures.geocode) {
      reverseGeocode(lat, lng)
        .then((g) => applyGeocodeToPopup(div, g))
        .catch(() => setCopyAddrBtn(div, { error: "反查失敗" }));
    }
    return div;
  }

  function syncMarkers() {
    const map = mapRef.current;
    const markerLayer = markerLayerRef.current;
    const data = dataRef.current;
    if (!map || !markerLayer || !data) return;
    if (Date.now() < useEmicStore.getState().mapPausedUntil) return;

    const filter = useEmicStore.getState().gpsFilter;
    const list = (data.gps || []).filter((p) =>
      filter === "all" ? true : p.isLive,
    );
    const seen = new Set<string>();
    const bounds: L.LatLngExpression[] = [];

    list.forEach((p) => {
      if (!p.lat || !p.lng || !p.ambulanceCode) return;
      const code = p.ambulanceCode;
      seen.add(code);
      gpsByCodeRef.current[code] = p;
      const sig = markerSignature(p);
      const sel = selectedAmbRef.current === code;
      let m = markerIndexRef.current[code];
      if (m && markerSigRef.current[code] === sig) {
        m.setZIndexOffset(sel ? 500 : 0);
        bounds.push([p.lat, p.lng]);
        return;
      }
      if (m) {
        (m as L.Marker & { _ambCode?: string })._ambCode = code;
        m.setLatLng([p.lat, p.lng]);
        m.setIcon(ambIcon(p));
        m.setZIndexOffset(sel ? 500 : 0);
      } else {
        m = L.marker([p.lat, p.lng], {
          icon: ambIcon(p),
          zIndexOffset: sel ? 500 : 0,
        }).addTo(markerLayer);
        (m as L.Marker & { _ambCode?: string })._ambCode = code;
        m.bindPopup(() => buildAmbPopup(gpsByCodeRef.current[code] || p), {
          maxWidth: 320,
        });
        m.on("click", () => {
          setSelectedAmb(code);
          pauseMap(8000);
        });
        markerIndexRef.current[code] = m;
      }
      markerSigRef.current[code] = sig;
      bounds.push([p.lat, p.lng]);
    });

    // remove vanished markers
    Object.keys(markerIndexRef.current).forEach((code) => {
      if (seen.has(code)) return;
      const m = markerIndexRef.current[code];
      markerLayer.removeLayer(m);
      delete markerIndexRef.current[code];
      delete markerSigRef.current[code];
      delete gpsByCodeRef.current[code];
    });

    if (!mapFittedRef.current && !userMovedMapRef.current && bounds.length) {
      const pad: L.PointExpression =
        window.innerWidth < 768 ? [60, 60] : [150, 150];
      map.fitBounds(bounds as L.LatLngBoundsExpression, {
        padding: pad,
        maxZoom: filter === "live" ? 14 : 12,
        animate: false,
      });
      mapFittedRef.current = true;
    }
  }
  syncMarkersRef.current = syncMarkers;

  // ── update markers when data changes ──
  useEffect(() => {
    if (!data) return;
    if (interactingRef.current) {
      pendingMarkerUpdateRef.current = true;
      return;
    }
    syncMarkers();
  }, [data, gpsFilter, mapPausedUntil]);

  // mapPausedUntil 到期後主動重繪（否則要等下一輪 poll 才會動）
  useEffect(() => {
    const left = mapPausedUntil - Date.now();
    if (left <= 0) return;
    const t = window.setTimeout(() => {
      if (!interactingRef.current) syncMarkersRef.current();
    }, left + 50);
    return () => window.clearTimeout(t);
  }, [mapPausedUntil]);

  // ── fly to selected ambulance ──
  useEffect(() => {
    if (!selectedAmb || !mapRef.current) return;
    const m = markerIndexRef.current[selectedAmb];
    if (!m) return;
    const ll = m.getLatLng();
    mapRef.current.flyTo(ll, Math.max(mapRef.current.getZoom(), 15), {
      duration: 0.35,
    });
    m.openPopup();
    // update z-index
    Object.entries(markerIndexRef.current).forEach(([code, mk]) => {
      mk.setZIndexOffset(code === selectedAmb ? 500 : 0);
    });
  }, [selectedAmb]);

  function emicIcon(c: EmicKmlCase): L.DivIcon {
    const src = c.icon || "";
    const html = src
      ? `<div class="emic-marker-wrap"><img src="${esc(src)}" alt="" width="28" height="28"/><span class="emic-badge ${c.isActive ? "on" : "off"}"></span></div>`
      : `<div class="emic-marker-wrap"><div class="amb-marker ${c.isActive ? "s8" : "stale"}" style="width:14px;height:14px;margin:7px"></div></div>`;
    return L.divIcon({
      className: "",
      html,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
  }

  function buildEmicPopup(c: EmicKmlCase): HTMLElement {
    const div = document.createElement("div");
    div.className = "map-popup";
    div.innerHTML = `<span class="emic-tag">EMIC 災情通報</span>
      <h4>${esc(c.category || c.name)} · ${esc(c.status || "—")}</h4>
      <div class="addr-block"><label>案件地點</label><div>${esc(c.address || "—")}</div></div>
      <div style="font-size:.78rem;color:var(--muted);margin-top:6px">
        次要類別：${esc(c.subCategory || "—")}<br>報案時間：${esc(c.reportTime || "—")}
      </div>
      ${navButtonsHtml(c.lat, c.lng)}`;
    return div;
  }

  // ── EMIC KML markers ──
  useEffect(() => {
    const layer = emicLayerRef.current;
    if (!layer) return;
    if (!emicMapOn || !emicKml?.cases?.length) {
      layer.clearLayers();
      emicMarkerIndexRef.current = {};
      return;
    }
    const seen = new Set<string>();
    emicKml.cases.forEach((c) => {
      if (!c.lat || !c.lng) return;
      seen.add(c.id);
      let m = emicMarkerIndexRef.current[c.id];
      if (!m) {
        m = L.marker([c.lat, c.lng], {
          icon: emicIcon(c),
          zIndexOffset: 200,
        }).addTo(layer);
        m.bindPopup(buildEmicPopup(c), { maxWidth: 320 });
        m.on("click", () => pauseMap(8000));
        emicMarkerIndexRef.current[c.id] = m;
      } else {
        m.setLatLng([c.lat, c.lng]);
        m.setIcon(emicIcon(c));
      }
    });
    Object.keys(emicMarkerIndexRef.current).forEach((id) => {
      if (seen.has(id)) return;
      layer.removeLayer(emicMarkerIndexRef.current[id]);
      delete emicMarkerIndexRef.current[id];
    });
  }, [emicKml, emicMapOn, pauseMap]);

  useEffect(() => {
    if (!selectedEmicId || !mapRef.current) return;
    const m = emicMarkerIndexRef.current[selectedEmicId];
    if (!m) return;
    mapRef.current.flyTo(m.getLatLng(), Math.max(mapRef.current.getZoom(), 15), {
      duration: 0.35,
    });
    m.openPopup();
  }, [selectedEmicId]);

  function recenter() {
    userMovedMapRef.current = false;
    mapFittedRef.current = false;
    if (dataRef.current && mapRef.current) {
      // trigger re-fit by toggling: simplest is to re-run fit with current gps
      const bounds: L.LatLngExpression[] = [];
      (dataRef.current.gps || [])
        .filter((p) => (gpsFilter === "all" ? true : p.isLive))
        .forEach((p) => {
          if (p.lat && p.lng) bounds.push([p.lat, p.lng]);
        });
      if (bounds.length) {
        const pad: L.PointExpression =
          window.innerWidth < 768 ? [60, 60] : [150, 150];
        mapRef.current.fitBounds(bounds as L.LatLngBoundsExpression, {
          padding: pad,
          maxZoom: gpsFilter === "live" ? 14 : 12,
          animate: true,
          duration: 0.35,
        });
      }
    }
  }

  return (
    <>
      <div id="emic-map" ref={containerRef} />
      <div id="emic-map-legend">
        <div className="lg-row">
          <span className="dot" style={{ background: "#ca8a04" }} /> 已派遣
        </div>
        <div className="lg-row">
          <span className="dot" style={{ background: "#ea580c" }} /> 已出發
        </div>
        <div className="lg-row">
          <span className="dot" style={{ background: "#2563eb" }} /> 已到達
        </div>
        <div className="lg-row">
          <span className="dot" style={{ background: "#16a34a" }} /> 執行中(影像)
        </div>
        {emicMapOn && emicKml ? (
          <>
            <div className="lg-row emic-lg-title">EMIC 災情</div>
            <div className="lg-row">
              <span className="dot" style={{ background: "#22c55e" }} /> 處理中
            </div>
            <div className="lg-row">
              <span className="dot" style={{ background: "#9ca3af" }} /> 已處理
            </div>
          </>
        ) : null}
      </div>
      <div id="emic-map-tools-mobile" aria-label="地圖工具">
        <button
          type="button"
          className={`tool-btn ${gpsFilter === "live" ? "on" : ""}`}
          onClick={() => setGpsFilter("live")}
          title="僅顯示活躍 GPS"
        >
          即時
        </button>
        <button
          type="button"
          className={`tool-btn ${gpsFilter === "all" ? "on" : ""}`}
          onClick={() => setGpsFilter("all")}
          title="顯示全部 GPS"
        >
          全部
        </button>
        <button
          type="button"
          className="tool-btn"
          onClick={recenter}
          title="重新置中"
        >
          置中
        </button>
      </div>
      <div id="emic-map-tools">
        <button
          type="button"
          className={`tool-btn ${gpsFilter === "live" ? "on" : ""}`}
          onClick={() => setGpsFilter("live")}
          title="僅顯示活躍 GPS（≤30 分鐘）"
        >
          即時 GPS
        </button>
        <button
          type="button"
          className={`tool-btn ${gpsFilter === "all" ? "on" : ""}`}
          onClick={() => setGpsFilter("all")}
          title="顯示全部 GPS（≤60 分鐘）"
        >
          全部 GPS
        </button>
        {emicFeatures.kml ? (
          <button
            type="button"
            className={`tool-btn emic-tool ${emicMapOn ? "on" : ""}`}
            onClick={() => setEmicMapOn(!emicMapOn)}
            title="EMIC 災情 KML 圖層"
          >
            災情{emicKml ? ` ${emicKml.summary.shown}` : ""}
          </button>
        ) : null}
        <button
          type="button"
          className="tool-btn"
          onClick={recenter}
          title="重新置中"
        >
          重新置中
        </button>
      </div>
    </>
  );
}
