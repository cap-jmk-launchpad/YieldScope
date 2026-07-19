/**
 * Ink-panel loading skeletons for the YieldScope dashboard.
 * Always visible without JS reveal classes (content never gated blank).
 * Shimmer respects prefers-reduced-motion.
 */

import type { CSSProperties } from "react";

type SkeletonProps = {
  className?: string;
  style?: CSSProperties;
};

function Bone({ className = "", style }: SkeletonProps) {
  return <span className={`dash-skel-bone ${className}`.trim()} style={style} aria-hidden />;
}

export function DashboardDataSkeleton({
  pageSize = 25,
}: {
  pageSize?: number;
}) {
  const rows = Math.min(8, Math.max(4, Math.min(pageSize, 8)));
  return (
    <div className="dash-skel" aria-busy="true" aria-live="polite">
      <p className="dash-skel-status">Loading ledger…</p>

      <div className="dash-skel-total">
        <Bone className="dash-skel-bone--lg" style={{ width: "min(28rem, 85%)" }} />
      </div>

      <div className="sources dash-skel-sources">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="source dash-skel-source" style={{ ["--i" as string]: i }}>
            <Bone style={{ width: "5.5rem" }} />
            <Bone style={{ width: "4rem" }} />
            <Bone style={{ width: "7rem" }} />
          </div>
        ))}
      </div>

      <div className="dash-skel-charts">
        <Bone className="dash-skel-bone--block" style={{ height: "12rem" }} />
        <Bone className="dash-skel-bone--block" style={{ height: "12rem" }} />
      </div>

      <div className="table-wrap dash-skel-table">
        <div className="dash-skel-table-head">
          <Bone style={{ width: "4rem" }} />
          <Bone style={{ width: "5rem" }} />
          <Bone style={{ width: "4rem" }} />
          <Bone style={{ width: "6rem" }} />
          <Bone style={{ width: "5rem" }} />
        </div>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="dash-skel-table-row" style={{ ["--i" as string]: i }}>
            <Bone style={{ width: "70%" }} />
            <Bone style={{ width: "55%" }} />
            <Bone style={{ width: "40%" }} />
            <Bone style={{ width: "60%" }} />
            <Bone style={{ width: "50%" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SyncRangeSkeleton() {
  return (
    <fieldset className="sync-range dash-skel-range" aria-busy="true">
      <legend className="sync-range-legend">Sync window</legend>
      <Bone style={{ width: "12rem", height: "1.1rem" }} />
      <Bone style={{ width: "min(20rem, 90%)", height: "2.2rem" }} />
      <Bone style={{ width: "min(36rem, 95%)", height: "2.5rem" }} />
    </fieldset>
  );
}

export function TableBodySkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} className="dash-skel-tr" style={{ ["--i" as string]: r }}>
          {Array.from({ length: cols }, (_, c) => (
            <td key={c}>
              <Bone style={{ width: `${55 + ((r + c) % 3) * 12}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
