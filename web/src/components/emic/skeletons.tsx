"use client";

/** Loading skeleton fragments reused across docks before first data arrives. */

export function DockSkeleton() {
  return (
    <div style={{ padding: 12 }}>
      <div className="skeleton skel-line w40" />
      <div className="skeleton skel-line w80" />
      <div className="skel-grid" style={{ marginTop: 12 }}>
        <div className="skeleton skel-block" />
        <div className="skeleton skel-block" />
        <div className="skeleton skel-block" />
        <div className="skeleton skel-block" />
      </div>
      <div className="skeleton skel-line w60" style={{ marginTop: 16 }} />
      <div className="skeleton skel-line w80" />
      <div className="skeleton skel-line w80" />
      <div className="skeleton skel-line w60" />
    </div>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div style={{ padding: "8px 12px" }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="skeleton"
          style={{ height: 36, marginBottom: 6 }}
        />
      ))}
    </div>
  );
}
