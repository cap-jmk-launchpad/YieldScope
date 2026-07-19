import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { InkBackground } from "../components/InkBackground";
import {
  clamp,
  cubicAt,
  cubicPath,
  easeExpressive,
  easeStandard,
  lerp,
  lerp2,
  staggerDelay,
  storyProgress,
  wrap01,
} from "../motion";
import { tokens } from "../tokens";

type StreamDef = {
  start: [number, number];
  c1: [number, number];
  c2: [number, number];
  weight: number;
  /** Hierarchy: lower = moves first */
  rank: number;
};

/** Normalized stream origins — arcs toward center ledger. */
const STREAMS: StreamDef[] = [
  { start: [0.04, 0.14], c1: [0.22, 0.1], c2: [0.38, 0.36], weight: 1.5, rank: 2 },
  { start: [0.02, 0.32], c1: [0.2, 0.28], c2: [0.4, 0.46], weight: 2.1, rank: 0 },
  { start: [0.05, 0.52], c1: [0.24, 0.5], c2: [0.42, 0.5], weight: 1.8, rank: 1 },
  { start: [0.03, 0.74], c1: [0.22, 0.7], c2: [0.4, 0.58], weight: 1.4, rank: 3 },
  { start: [0.96, 0.16], c1: [0.78, 0.14], c2: [0.6, 0.38], weight: 1.6, rank: 2 },
  { start: [0.98, 0.38], c1: [0.78, 0.4], c2: [0.58, 0.48], weight: 2.2, rank: 0 },
  { start: [0.95, 0.58], c1: [0.76, 0.56], c2: [0.58, 0.52], weight: 1.7, rank: 1 },
  { start: [0.97, 0.8], c1: [0.74, 0.76], c2: [0.56, 0.6], weight: 1.5, rank: 3 },
  { start: [0.28, 0.05], c1: [0.34, 0.2], c2: [0.44, 0.4], weight: 1.3, rank: 4 },
  { start: [0.72, 0.95], c1: [0.64, 0.8], c2: [0.54, 0.6], weight: 1.35, rank: 4 },
  { start: [0.5, 0.04], c1: [0.5, 0.18], c2: [0.5, 0.38], weight: 1.9, rank: 1 },
  { start: [0.5, 0.96], c1: [0.5, 0.82], c2: [0.5, 0.62], weight: 1.9, rank: 2 },
];

const TICKS = [0.18, 0.3, 0.42, 0.5, 0.58, 0.7, 0.82];

/**
 * V1 — Scattered streams consolidate into one ledger line.
 * Craft: anticipation → staggered converge → readable hold → overlapping release.
 * Traveling energy (dash + beads) as secondary action.
 */
export const ScatteredLedger: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const t = frame / durationInFrames;
  const { converge, anticipate, hold } = storyProgress(t);
  const flow = wrap01(t * 1.35);

  const ledgerY = height * 0.5;
  const ledgerLeft = width * 0.24;
  const ledgerRight = width * 0.76;
  const midX = width * 0.5;

  const sorted = useMemo(
    () => [...STREAMS].sort((a, b) => a.rank - b.rank),
    [],
  );

  const streams = useMemo(() => {
    return sorted.map((s, i) => {
      const delay = staggerDelay(i, sorted.length, 0.16);
      const local = Math.max(0, Math.min(1, converge - delay));
      const pull = Easing.bezier(0.16, 1, 0.3, 1)(local);
      // Anticipation: slight outward before pull-in (overlapping action)
      const anti = anticipate * (1 - pull) * 0.35;
      const outward: [number, number] = [
        s.start[0] + (s.start[0] - 0.5) * anti,
        s.start[1] + (s.start[1] - 0.5) * anti * 0.6,
      ];

      const p0: [number, number] = [outward[0] * width, outward[1] * height];
      const target: [number, number] = [midX, ledgerY];
      const p3 = lerp2(p0, target, pull);
      const p1 = lerp2(
        [s.c1[0] * width, s.c1[1] * height],
        lerp2(p0, target, 0.33),
        pull * 0.7,
      );
      const p2 = lerp2(
        [s.c2[0] * width, s.c2[1] * height],
        lerp2(p0, target, 0.72),
        pull * 0.85,
      );

      const d = cubicPath(p0, p1, p2, p3);
      const opacity = interpolate(
        pull,
        [0, 0.15, 0.75, 1],
        [0.22, 0.55, 0.78, 0.18],
        clamp,
      );
      // Energy bead travels along path — secondary action
      const beadU = wrap01(flow + i * 0.07 + delay);
      const bead = cubicAt(p0, p1, p2, p3, beadU);
      const dashOffset = -flow * 140 - i * 18;

      return {
        d,
        opacity,
        weight: s.weight,
        bead,
        dashOffset,
        pull,
        rank: s.rank,
      };
    });
  }, [
    sorted,
    converge,
    anticipate,
    width,
    height,
    midX,
    ledgerY,
    flow,
  ]);

  const ledgerLen = interpolate(converge, [0, 0.35, 1], [0.08, 0.55, 1], {
    ...clamp,
    easing: easeExpressive,
  });
  const half = ((ledgerRight - ledgerLeft) / 2) * ledgerLen;
  const ledgerOpacity = interpolate(
    converge,
    [0, 0.2, 0.55, 0.85, 1],
    [0.08, 0.45, 0.95, 0.55, 0.1],
    clamp,
  );
  const ledgerGlow = interpolate(hold, [0, 1], [0, 0.22], clamp);

  // Readable hold: ticks cascade after ledger forms
  const tickStrength = interpolate(hold, [0, 1], [0, 1], {
    ...clamp,
    easing: easeStandard,
  });

  // Ambient field intensity follows story
  const bgIntensity = interpolate(converge, [0, 1], [0.85, 1.15], clamp);

  return (
    <AbsoluteFill>
      <InkBackground intensity={bgIntensity} />
      <AbsoluteFill>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          style={{ position: "absolute", inset: 0 }}
        >
          <defs>
            <linearGradient id="sl-stream" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={tokens.accentDim} stopOpacity="0.2" />
              <stop offset="40%" stopColor={tokens.accent} stopOpacity="0.85" />
              <stop offset="100%" stopColor={tokens.accentDim} stopOpacity="0.25" />
            </linearGradient>
            <linearGradient id="sl-ledger" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={tokens.accent} stopOpacity="0" />
              <stop offset="12%" stopColor={tokens.accent} stopOpacity="0.75" />
              <stop offset="50%" stopColor={tokens.paper} stopOpacity="0.95" />
              <stop offset="88%" stopColor={tokens.accent} stopOpacity="0.75" />
              <stop offset="100%" stopColor={tokens.accent} stopOpacity="0" />
            </linearGradient>
            <filter id="sl-soft" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="1.2" />
            </filter>
          </defs>

          {/* Soft ledger halo — restrained, not neon bloom */}
          <ellipse
            cx={midX}
            cy={ledgerY}
            rx={half * 1.05}
            ry={18 + hold * 10}
            fill={tokens.accent}
            opacity={ledgerGlow}
            filter="url(#sl-soft)"
          />

          {streams.map((s, i) => (
            <g key={i}>
              <path
                d={s.d}
                fill="none"
                stroke="url(#sl-stream)"
                strokeWidth={s.weight}
                strokeLinecap="round"
                opacity={s.opacity * 0.45}
                strokeDasharray="2 14"
                strokeDashoffset={s.dashOffset}
              />
              <path
                d={s.d}
                fill="none"
                stroke="url(#sl-stream)"
                strokeWidth={s.weight}
                strokeLinecap="round"
                opacity={s.opacity}
              />
              <circle
                cx={s.bead[0]}
                cy={s.bead[1]}
                r={1.6 + s.pull * 1.4}
                fill={tokens.accent}
                opacity={0.35 + s.pull * 0.45}
              />
            </g>
          ))}

          {/* Ledger line — primary staging */}
          <line
            x1={midX - half}
            y1={ledgerY}
            x2={midX + half}
            y2={ledgerY}
            stroke="url(#sl-ledger)"
            strokeWidth={2.75}
            strokeLinecap="round"
            opacity={ledgerOpacity}
          />

          {TICKS.map((u, i) => {
            const stagger = i / (TICKS.length - 1);
            const localHold = interpolate(
              tickStrength,
              [stagger * 0.35, stagger * 0.35 + 0.4],
              [0, 1],
              clamp,
            );
            const x = lerp(ledgerLeft, ledgerRight, u);
            const h = lerp(0, 11, localHold);
            return (
              <line
                key={i}
                x1={x}
                y1={ledgerY - h}
                x2={x}
                y2={ledgerY + h}
                stroke={tokens.accent}
                strokeWidth={1.15}
                opacity={localHold * ledgerOpacity * 0.7}
              />
            );
          })}

          {/* Center checkpoint mark at peak hold */}
          <circle
            cx={midX}
            cy={ledgerY}
            r={interpolate(hold, [0, 1], [0, 4.5], clamp)}
            fill={tokens.accent}
            opacity={hold * 0.9}
          />
        </svg>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
