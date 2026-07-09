"use client";

import { useEmicStore } from "@/lib/emic/store";
import { statusPill } from "@/lib/emic/format";
import { Bell } from "lucide-react";

export function AlertBar() {
  const data = useEmicStore((s) => s.data);
  const alerts = (data?.alerts || []).slice(0, 2);
  if (!alerts.length) return null;

  return (
    <div id="emic-alert-bar" role="status" aria-live="polite" aria-atomic="false">
      {alerts.map((a, i) => {
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
                  : "new";
        const nameToId: Record<string, number> = {
          已派遣: 5,
          已出發: 6,
          已到達: 7,
          "執行中(有影像)": 8,
          "執行中(影像)": 8,
        };
        return (
          <div className={`alert-item ${cls}`} key={i}>
            <Bell size={13} />
            {m ? (
              <>
                狀態變更 <b>{m[1]}</b>{" "}
                <span
                  dangerouslySetInnerHTML={{
                    __html: statusPill(nameToId[m[2].trim()], m[2].trim()),
                  }}
                />
                <span className="alert-arrow">→</span>
                <span
                  dangerouslySetInnerHTML={{
                    __html: statusPill(nameToId[m[3].trim()], m[3].trim()),
                  }}
                />
              </>
            ) : (
              a.msg
            )}
          </div>
        );
      })}
    </div>
  );
}
