import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { InkBackground } from "../components/InkBackground";
import { tokens } from "../tokens";

type StreamSpec = {
  /** Start XY in normalized 0–1 space */
  sx: number;
  sy: number;
  /** Control point offsets */
  c1x: number;
  c1y: number;
  c2x: number;
  c2y: number;
  stroke: number;
  delay: number;
};

const STREAMS: StreamSpec[] = [
  { sx: 0.06, sy: 0.18, c1x: 0.28, c1y: 0.12, c2x: 0.42, c2y: 0.38, stroke: 1.6, delay: 0 },
  { sx: 0.04, sy: 0.42, c1x: 0.22, c1y: 0.35, c2x: 0.4, c2y: 0.48, stroke: 2.0, delay: 0.08 },
  { sx: 0.08, sy: 0.72, c1x: 0.26, c1y: 0.68, c2x: 0.44, c2y: 0.55, stroke: 1.4, delay: 0.15 },
  { sx: 0.94, sy: 0.22, c1x: 0.72, c1y: 0.18, c2x: 0.58, c2y: 0.4, stroke: 1.8, delay: 0.05 },
  { sx: 0.96, sy: 0.5, c1x: 0.74, c1y: 0.48, c2x: 0.58, c2y: 0.5, stroke: 2.2, delay: 0.12 },
  { sx: 0.92, sy: 0.78, c1x: 0.7, c1y: 0.74, c2x: 0.56, c2y: 0.58, stroke: 1.5, delay: 0.2 },
  { sx: 0.35, sy: 0.08, c1x: 0.4, c1y: 0.22, c2x: 0.46, c2y: 0.4, stroke: 1.3, delay: 0.1 },
  { sx: 0.65, sy: 0.92, c1x: 0.58, c1y: 0.78, c2x: 0.52, c2y: 0.58, stroke: 1.4, delay: 0.18 },
];

/** Seamless 0→1→0 envelope so frame 0 matches frame duration. */
function loopPulse(t: number): number {
  // Triangle via cosine: 0 at edges, 1 at mid
  return 0.5 - 0.5 * Math.cos(t * Math.PI * 2);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * V1 — Scattered streams converge into one ledger line, then release.
 * Full cycle is one seamless 10s loop.
 */
export const ScatteredLedger: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const t = frame / durationInFrames;
  const converge = loopPulse(t);

  const ledgerY = height * 0.5;
  const ledgerLeft = width * 0.28;
  const ledgerRight = width * 0.72;
  const ledgerLen = interpolate(converge, [0, 1], [0.15, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const ledgerOpacity = interpolate(converge, [0, 0.25, 0.75, 1], [0.15, 0.85, 0.95, 0.15], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const paths = useMemo(() => {
    return STREAMS.map((s) => {
      const local = Math.max(0, Math.min(1, converge - s.delay * 0.35));
      const pull = Easing.out(Easing.cubic)(local);
      const endX = lerp(s.sx * width, width * 0.5, pull);
      const endY = lerp(s.sy * height, ledgerY, pull);
      const c1x = lerp(s.c1x * width, lerp(s.sx * width, width * 0.5, 0.35), pull * 0.6);
      const c1y = lerp(s.c1y * height, lerp(s.sy * height, ledgerY, 0.35), pull * 0.6);
      const c2x = lerp(s.c2x * width, width * 0.5, pull * 0.85);
      const c2y = lerp(s.c2y * height, ledgerY, pull * 0.85);
      const d = `M ${s.sx * width} ${s.sy * height} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${endX} ${endY}`;
      const opacity = interpolate(pull, [0, 0.2, 0.85, 1], [0.25, 0.55, 0.7, 0.2]);
      return { d, stroke: s.stroke, opacity, pull };
    });
  }, [converge, width, height, ledgerY]);

  const midX = (ledgerLeft + ledgerRight) / 2;
  const half = ((ledgerRight - ledgerLeft) / 2) * ledgerLen;

  return (
    <AbsoluteFill>
      <InkBackground />
      <AbsoluteFill>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          style={{ position: "absolute", inset: 0 }}
        >
          <defs>
            <linearGradient id="streamGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={tokens.accentDim} stopOpacity="0.35" />
              <stop offset="50%" stopColor={tokens.accent} stopOpacity="0.9" />
              <stop offset="100%" stopColor={tokens.accentDim} stopOpacity="0.35" />
            </linearGradient>
            <linearGradient id="ledgerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={tokens.accent} stopOpacity="0" />
              <stop offset="20%" stopColor={tokens.accent} stopOpacity="0.85" />
              <stop offset="80%" stopColor={tokens.accent} stopOpacity="0.85" />
              <stop offset="100%" stopColor={tokens.accent} stopOpacity="0" />
            </linearGradient>
          </defs>

          {paths.map((p, i) => (
            <path
              key={i}
              d={p.d}
              fill="none"
              stroke="url(#streamGrad)"
              strokeWidth={p.stroke}
              strokeLinecap="round"
              opacity={p.opacity}
            />
          ))}

          {/* Ledger line — the consolidated earn signal */}
          <line
            x1={midX - half}
            y1={ledgerY}
            x2={midX + half}
            y2={ledgerY}
            stroke="url(#ledgerGrad)"
            strokeWidth={2.5}
            strokeLinecap="round"
            opacity={ledgerOpacity}
          />
          {/* Thin hash ticks along ledger at peak converge */}
          {[0.2, 0.35, 0.5, 0.65, 0.8].map((u, i) => {
            const x = lerp(ledgerLeft, ledgerRight, u);
            const tickH = interpolate(converge, [0.4, 0.7, 1], [0, 10, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            return (
              <line
                key={`tick-${i}`}
                x1={x}
                y1={ledgerY - tickH}
                x2={x}
                y2={ledgerY + tickH}
                stroke={tokens.accent}
                strokeWidth={1}
                opacity={ledgerOpacity * 0.55}
              />
            );
          })}
        </svg>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
