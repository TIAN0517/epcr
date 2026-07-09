"use client";

import { useEmicStore } from "@/lib/emic/store";
import type { EmicKmlRegion } from "@/lib/emic/types";

const REGIONS: { id: EmicKmlRegion; label: string }[] = [
  { id: "kaohsiung", label: "高雄市" },
  { id: "ntpc", label: "新北市" },
  { id: "all", label: "全國" },
];

export function EmicKmlFilters({ showMapToggle = false }: { showMapToggle?: boolean }) {
  const emicRegion = useEmicStore((s) => s.emicRegion);
  const emicActiveOnly = useEmicStore((s) => s.emicActiveOnly);
  const emicMapOn = useEmicStore((s) => s.emicMapOn);
  const setEmicRegion = useEmicStore((s) => s.setEmicRegion);
  const setEmicActiveOnly = useEmicStore((s) => s.setEmicActiveOnly);
  const setEmicMapOn = useEmicStore((s) => s.setEmicMapOn);

  return (
    <div className="emic-kml-filters">
      {REGIONS.map((r) => (
        <button
          key={r.id}
          type="button"
          className={emicRegion === r.id ? "on" : ""}
          onClick={() => setEmicRegion(r.id)}
        >
          {r.label}
        </button>
      ))}
      <button
        type="button"
        className={emicActiveOnly ? "on" : ""}
        onClick={() => setEmicActiveOnly(!emicActiveOnly)}
      >
        處理中
      </button>
      {showMapToggle ? (
        <button
          type="button"
          className={emicMapOn ? "on" : ""}
          onClick={() => setEmicMapOn(!emicMapOn)}
        >
          地圖
        </button>
      ) : null}
    </div>
  );
}