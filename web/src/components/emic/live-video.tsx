"use client";

import { useEffect, useRef, useState } from "react";
import { Video } from "lucide-react";

type MpegtsPlayer = {
  destroy: () => void;
  attachMediaElement: (el: HTMLMediaElement) => void;
  load: () => void;
  on: (evt: string, cb: () => void) => void;
};

declare global {
  interface Window {
    mpegts?: {
      getFeatureList: () => { mseLivePlayback?: boolean };
      createPlayer: (
        cfg: { type: string; isLive: boolean; url: string },
        opts?: unknown
      ) => MpegtsPlayer;
      Events: { ERROR: string };
    };
  }
}

function loadMpegts(): Promise<NonNullable<Window["mpegts"]>> {
  if (window.mpegts) return Promise.resolve(window.mpegts);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-emic-mpegts]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.mpegts!));
      existing.addEventListener("error", reject);
      return;
    }
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/mpegts.js@1.7.3/dist/mpegts.js";
    s.async = true;
    s.dataset.emicMpegts = "1";
    s.onload = () => resolve(window.mpegts!);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

type LiveVideoProps = {
  streamId: string;
  className?: string;
  height?: number | string;
};

export function LiveVideo({ streamId, className, height = 240 }: LiveVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<MpegtsPlayer | null>(null);
  const [phase, setPhase] = useState<"connecting" | "playing" | "error">("connecting");

  useEffect(() => {
    let cancelled = false;
    let connectTimer: ReturnType<typeof setTimeout> | null = null;
    const video = videoRef.current;
    if (!video || !streamId) return;

    setPhase("connecting");

    const fail = () => {
      if (!cancelled) setPhase("error");
    };

    const onPlaying = () => {
      if (!cancelled) {
        if (connectTimer) clearTimeout(connectTimer);
        setPhase("playing");
      }
    };

    video.addEventListener("playing", onPlaying);
    video.addEventListener("error", fail);

    (async () => {
      try {
        const ticketRes = await fetch(
          `/api/emic/play?id=${encodeURIComponent(streamId)}`,
          { credentials: "same-origin" }
        );
        if (!ticketRes.ok) {
          fail();
          return;
        }
        const ticket = (await ticketRes.json()) as {
          ok?: boolean;
          hasStream?: boolean;
          playUrl?: string;
        };
        if (!ticket.ok || !ticket.hasStream || !ticket.playUrl) {
          fail();
          return;
        }

        const mpegts = await loadMpegts();
        if (cancelled) return;
        if (!mpegts.getFeatureList().mseLivePlayback) {
          fail();
          return;
        }

        connectTimer = setTimeout(fail, 20_000);

        const player = mpegts.createPlayer({
          type: "mse",
          isLive: true,
          url: ticket.playUrl,
        });
        playerRef.current = player;
        if (mpegts.Events?.ERROR) {
          player.on(mpegts.Events.ERROR, fail);
        }
        player.attachMediaElement(video);
        player.load();
        await video.play().catch(fail);
      } catch {
        fail();
      }
    })();

    return () => {
      cancelled = true;
      if (connectTimer) clearTimeout(connectTimer);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("error", fail);
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          /* ignore */
        }
        playerRef.current = null;
      }
    };
  }, [streamId]);

  return (
    <div className={className ?? "vw-offline"} style={{ height, position: "relative" }}>
      <video
        ref={videoRef}
        muted
        autoPlay
        playsInline
        controls
        style={{
          width: "100%",
          height: "100%",
          background: "#000",
          display: phase === "playing" ? "block" : "none",
        }}
      />
      {phase !== "playing" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <Video size={28} style={{ opacity: 0.4 }} />
          <div>{phase === "connecting" ? "訊號連接中…" : "影像無法載入"}</div>
          {phase === "connecting" && (
            <small style={{ color: "var(--muted-2)" }}>正在連接現場串流</small>
          )}
          {phase === "error" && (
            <small style={{ color: "var(--muted-2)" }}>
              現場未推流或網路暫時無法連線
            </small>
          )}
        </div>
      )}
    </div>
  );
}