"use client";

import { useEmicStore } from "@/lib/emic/store";
import { esc } from "@/lib/emic/format";
import { LiveVideo } from "@/components/emic/live-video";
import { Video, X } from "lucide-react";

export function VideoWall() {
  const open = useEmicStore((s) => s.videoWallOpen);
  const setOpen = useEmicStore((s) => s.setVideoWallOpen);
  const data = useEmicStore((s) => s.data);

  if (!open) return null;

  const live = data?.liveVideo || (data?.dispatches || []).filter((x) => x.hasLiveVideo);

  return (
    <div
      id="emic-videowall"
      className="open"
      role="dialog"
      aria-modal="true"
      aria-label="即時影像監看牆"
    >
      <div className="vw-head">
        <strong>
          <Video size={18} /> 即時影像監看牆
          <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 13 }}>
            （StatusId=8 執行中案件）
          </span>
        </strong>
        <button type="button" onClick={() => setOpen(false)}>
          <X size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />
          關閉
        </button>
      </div>
      <div className="vw-grid emic-scroll">
        {!live || live.length === 0 ? (
          <div
            className="empty"
            style={{ gridColumn: "1 / -1", padding: "60px 8px" }}
          >
            目前無 StatusId=8 即時影像案件
            <br />
            <small>案件進入執行中狀態後會自動出現</small>
          </div>
        ) : (
          live.map((c, i) => (
            <div className="vw-tile" key={c.uuid || i}>
              <h3>
                <Video size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />
                {esc(c.ambulanceCode) || "—"} · {esc(c.branch) || "—"} ·{" "}
                {esc(c.statusName) || ""}
              </h3>
              <LiveVideo streamId={c.uuid} height={200} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
