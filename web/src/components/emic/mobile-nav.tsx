"use client";

import { useEmicStore } from "@/lib/emic/store";
import type { MobileView } from "@/lib/emic/format";
import { Map as MapIcon, BarChart3, Ambulance } from "lucide-react";

export function MobileNav() {
  const mobileView = useEmicStore((s) => s.mobileView);
  const setMobileView = useEmicStore((s) => s.setMobileView);

  const btns: { v: MobileView; icon: React.ReactNode; label: string }[] = [
    { v: "map", icon: <MapIcon size={18} />, label: "地圖" },
    { v: "left", icon: <BarChart3 size={18} />, label: "概況" },
    { v: "right", icon: <Ambulance size={18} />, label: "出勤" },
  ];

  return (
    <nav className="mobile-nav" aria-label="主視圖切換">
      {btns.map((b) => (
        <button
          key={b.v}
          type="button"
          className={mobileView === b.v ? "on" : ""}
          onClick={() => setMobileView(b.v)}
          aria-label={b.label}
          aria-pressed={mobileView === b.v}
        >
          {b.icon}
          {b.label}
        </button>
      ))}
    </nav>
  );
}
