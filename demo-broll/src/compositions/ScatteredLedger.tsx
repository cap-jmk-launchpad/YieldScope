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
  easeExpressive,
  easeStandard,
  lerp,
  staggerDelay,
  storyProgress,
  wrap01,
} from "../motion";
import { oceanHeight } from "../ocean";
import { tokens } from "../tokens";

type StreamOrigin = {
  /** Angle from center (radians) */
  angle: number;
  radius: number;
  rank: number;
  particleCount: number;
};

/** Particle streams arriving from the periphery on ocean-shaped arcs. */
const ORIGINS: StreamOrigin[] = [
  { angle: -2.6, radius: 0.92, rank: 0, particleCount: 18 },
  { angle: -1.9, radius: 0.88, rank: 1, particleCount: 14 },
  { angle: -1.1, radius: 0.9, rank: 0, particleCount: 16 },
  { angle: -0.35, radius: 0.86, rank: 2, particleCount: 12 },
  { angle: 0.4, radius: 0.9, rank: 1, particleCount: 15 },
  { angle: 1.15, radius: 0.88, rank: 0, particleCount: 17 },
  { angle: 1.95, radius: 0.91, rank: 2, particleCount: 13 },
  { angle: 2.7, radius: 0.87, rank: 1, particleCount: 14 },
  { angle: 3.2, radius: 0.93, rank: 3, particleCount: 11 },
  { angle: -3.0, radius: 0.85, rank: 2, particleCount: 12 },
];

const TICKS = [0.2, 0.32, 0.44, 0.5, 0.56, 0.68, 0.8];

/**
 * V1 — Scattered particle-ocean streams consolidate into one ledger.
 * Particles ride multi-layer ocean displacement along radial paths;
 * crest density reads as foam. Blocks appear as short ledger ticks at hold.
 */
export const ScatteredLedger: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const t = frame / durationInFrames;
  const { converge, anticipate, hold } = storyProgress(t);
  const travel = wrap01(t);

  const cx = width * 0.5;
  const cy = height * 0.5;
  const maxR = Math.min(width, height) * 0.48;

  const sorted = useMemo(
    () => [...ORIGINS].sort((a, b) => a.rank - b.rank),
    [],
  );

  const streams = useMemo(() => {
    return sorted.map((origin, si) => {
      const delay = staggerDelay(si, sorted.length, 0.15);
      const local = Math.max(0, Math.min(1, converge - delay));
      const pull = Easing.bezier(0.16, 1, 0.3, 1)(local);
      const anti = anticipate * (1 - pull);

      const particles: Array<{
        x: number;
        y: number;
        r: number;
        o: number;
      }> = [];

      for (let p = 0; p < origin.particleCount; p++) {
        // Particle progress along stream 0 (rim) → 1 (center)
        const baseU = p / (origin.particleCount - 1);
        // Traveling foam along the stream
        const flowU = wrap01(baseU * 0.85 + travel * 1.1 + si * 0.05);
        const u = lerp(flowU, 1, pull * 0.92);

        // Ocean modulation perpendicular to radial path
        const wave = oceanHeight(u + si * 0.07, travel + si * 0.03, {
          swellAmp: 0.9 + anti * 0.5,
          seaAmp: 1,
          chopAmp: 1.1,
          scale: 1,
        });

        const startR = origin.radius * maxR * (1 + anti * 0.12);
        const r = lerp(startR, 8, u);
        const angle =
          origin.angle +
          wave.height * 0.22 * (1 - pull) +
          Math.sin(travel * Math.PI * 2 + p * 0.3) * 0.04 * (1 - pull);

        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r + wave.height * 28 * (1 - pull);

        const crestBoost = wave.crest;
        const nearCenter = u;
        particles.push({
          x,
          y,
          r: 1.1 + crestBoost * 1.8 + nearCenter * pull * 1.2,
          o:
            (0.2 + crestBoost * 0.5) *
            interpolate(pull, [0, 0.3, 0.85, 1], [0.55, 0.85, 0.7, 0.15], clamp) *
            interpolate(u, [0, 0.15, 0.9, 1], [0.3, 1, 1, 0.4], clamp),
        });
      }

      // Soft trail path through particle centroids (subtle connector)
      const pathPts: string[] = [];
      const steps = 24;
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const wave = oceanHeight(u + si * 0.07, travel + si * 0.03, {
          scale: 1,
          swellAmp: 0.9,
          seaAmp: 1,
          chopAmp: 1,
        });
        const startR = origin.radius * maxR * (1 + anti * 0.12);
        const r = lerp(startR, 8, lerp(u, 1, pull * 0.92));
        const angle = origin.angle + wave.height * 0.22 * (1 - pull);
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r + wave.height * 28 * (1 - pull);
        pathPts.push(i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`);
      }

      return {
        particles,
        path: pathPts.join(" "),
        pathOpacity: interpolate(pull, [0, 0.4, 1], [0.12, 0.28, 0.05], clamp),
        pull,
      };
    });
  }, [sorted, converge, anticipate, travel, cx, cy, maxR]);

  const ledgerLeft = width * 0.26;
  const ledgerRight = width * 0.74;
  const ledgerLen = interpolate(converge, [0, 0.4, 1], [0.1, 0.6, 1], {
    ...clamp,
    easing: easeExpressive,
  });
  const half = ((ledgerRight - ledgerLeft) / 2) * ledgerLen;
  const ledgerOpacity = interpolate(
    converge,
    [0, 0.25, 0.55, 0.85, 1],
    [0.06, 0.4, 0.95, 0.5, 0.1],
    clamp,
  );
  const tickStrength = interpolate(hold, [0, 1], [0, 1], {
    ...clamp,
    easing: easeStandard,
  });

  return (
    <AbsoluteFill>
      <InkBackground
        intensity={interpolate(converge, [0, 1], [0.9, 1.15], clamp)}
      />
      <AbsoluteFill>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          style={{ position: "absolute", inset: 0 }}
        >
          <defs>
            <linearGradient id="sl2-ledger" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={tokens.accent} stopOpacity="0" />
              <stop offset="15%" stopColor={tokens.accent} stopOpacity="0.8" />
              <stop offset="50%" stopColor={tokens.paper} stopOpacity="0.95" />
              <stop offset="85%" stopColor={tokens.accent} stopOpacity="0.8" />
              <stop offset="100%" stopColor={tokens.accent} stopOpacity="0" />
            </linearGradient>
            <radialGradient id="sl2-core" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={tokens.accent} stopOpacity="0.5" />
              <stop offset="100%" stopColor={tokens.accent} stopOpacity="0" />
            </radialGradient>
          </defs>

          {streams.map((s, i) => (
            <g key={i}>
              <path
                d={s.path}
                fill="none"
                stroke={tokens.accent}
                strokeWidth={1.1}
                opacity={s.pathOpacity}
                strokeLinecap="round"
              />
              {s.particles.map((p, j) => (
                <circle
                  key={j}
                  cx={p.x}
                  cy={p.y}
                  r={p.r}
                  fill={tokens.accent}
                  opacity={p.o}
                />
              ))}
            </g>
          ))}

          <ellipse
            cx={cx}
            cy={cy}
            rx={half * 1.05}
            ry={14 + hold * 8}
            fill="url(#sl2-core)"
            opacity={hold * 0.35}
          />

          <line
            x1={cx - half}
            y1={cy}
            x2={cx + half}
            y2={cy}
            stroke="url(#sl2-ledger)"
            strokeWidth={2.6}
            strokeLinecap="round"
            opacity={ledgerOpacity}
          />

          {/* Block ticks — discrete ledger marks at hold */}
          {TICKS.map((u, i) => {
            const stagger = i / (TICKS.length - 1);
            const localHold = interpolate(
              tickStrength,
              [stagger * 0.3, stagger * 0.3 + 0.45],
              [0, 1],
              clamp,
            );
            const x = lerp(ledgerLeft, ledgerRight, u);
            const h = lerp(0, 14, localHold);
            const w = 3.5;
            return (
              <rect
                key={i}
                x={x - w / 2}
                y={cy - h}
                width={w}
                height={h * 2}
                rx={1.2}
                fill={tokens.accent}
                opacity={localHold * ledgerOpacity * 0.75}
              />
            );
          })}

          <circle
            cx={cx}
            cy={cy}
            r={interpolate(hold, [0, 1], [0, 4.5], clamp)}
            fill={tokens.paper}
            opacity={hold * 0.95}
          />
        </svg>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
