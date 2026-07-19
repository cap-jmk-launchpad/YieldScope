import React, { useMemo } from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { InkBackground } from "../components/InkBackground";
import {
  clamp,
  easeEditorial,
  easeExpressive,
  easeStandard,
  lerp,
  storyProgress,
  wrap01,
} from "../motion";
import { tokens } from "../tokens";

type LaneDef = {
  yNorm: number;
  amp: number;
  freq: number;
  phase: number;
  weight: number;
  /** Hierarchy rank — lower weaves first */
  rank: number;
};

/** Four unnamed source lanes — geometric only. */
const LANES: LaneDef[] = [
  { yNorm: 0.28, amp: 56, freq: 2.2, phase: 0.0, weight: 1.7, rank: 1 },
  { yNorm: 0.4, amp: 44, freq: 2.8, phase: 1.1, weight: 2.3, rank: 0 },
  { yNorm: 0.6, amp: 48, freq: 2.5, phase: 2.2, weight: 1.9, rank: 0 },
  { yNorm: 0.72, amp: 40, freq: 3.1, phase: 3.0, weight: 1.6, rank: 2 },
];

function buildLanePath(
  width: number,
  height: number,
  lane: LaneDef,
  weave: number,
  travel: number,
  anti: number,
): string {
  const baseY = lane.yNorm * height;
  const targetY = height * 0.5;
  // Anticipation: lanes drift apart slightly before lock
  const spreadY = baseY + (baseY - targetY) * anti * 0.4;
  const steps = 96;
  const parts: string[] = [];

  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const x = u * width;
    // Frequency phase-locks toward center as weave rises (coherence)
    const freq = lerp(lane.freq, 1.15, weave);
    const amp = lane.amp * (1 - weave * 0.92) * (1 + anti * 0.25);
    const wave =
      Math.sin(u * Math.PI * freq + lane.phase + travel * Math.PI * 2) * amp;
    // Editorial ease into braid
    const lock = easeEditorial(weave);
    const y = lerp(spreadY + wave, targetY, lock);
    parts.push(i === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : `L ${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return parts.join(" ");
}

function beadOnLane(
  width: number,
  height: number,
  lane: LaneDef,
  weave: number,
  travel: number,
  anti: number,
  u: number,
): [number, number] {
  const baseY = lane.yNorm * height;
  const targetY = height * 0.5;
  const spreadY = baseY + (baseY - targetY) * anti * 0.4;
  const x = u * width;
  const freq = lerp(lane.freq, 1.15, weave);
  const amp = lane.amp * (1 - weave * 0.92) * (1 + anti * 0.25);
  const wave =
    Math.sin(u * Math.PI * freq + lane.phase + travel * Math.PI * 2) * amp;
  const lock = easeEditorial(weave);
  const y = lerp(spreadY + wave, targetY, lock);
  return [x, y];
}

/**
 * V2 — Source lanes weave into one earn pulse.
 * Craft: anticipation spread → phase-lock braid → hold pulse → release.
 * Traveling beads + ring follow-through as secondary action.
 */
export const SourceWeave: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const t = frame / durationInFrames;
  const { converge, anticipate, hold } = storyProgress(t);
  const travel = wrap01(t);
  const flow = wrap01(t * 1.2);

  const sorted = useMemo(
    () => [...LANES].sort((a, b) => a.rank - b.rank),
    [],
  );

  const lanes = useMemo(() => {
    return sorted.map((lane, i) => {
      const delay = (i / Math.max(1, sorted.length - 1)) * 0.12;
      const local = Math.max(0, Math.min(1, converge - delay * 0.5));
      const weave = easeExpressive(local);
      const d = buildLanePath(width, height, lane, weave, travel, anticipate);
      const opacity = interpolate(
        weave,
        [0, 0.25, 0.7, 1],
        [0.32 + i * 0.04, 0.72, 0.5, 0.28 + i * 0.04],
        clamp,
      );
      const beadU = wrap01(flow + i * 0.19 + delay);
      const bead = beadOnLane(
        width,
        height,
        lane,
        weave,
        travel,
        anticipate,
        beadU,
      );
      const dashOffset = -flow * 160 - i * 22;
      return { d, opacity, weight: lane.weight, bead, dashOffset, weave };
    });
  }, [sorted, converge, anticipate, width, height, travel, flow]);

  const pulseR = interpolate(converge, [0, 0.5, 1], [3, 16, 5], {
    ...clamp,
    easing: easeExpressive,
  });
  const pulseOpacity = interpolate(
    converge,
    [0, 0.35, 0.55, 0.8, 1],
    [0.12, 0.7, 0.95, 0.4, 0.12],
    clamp,
  );
  const ringR = interpolate(hold, [0, 1], [8, 42], {
    ...clamp,
    easing: easeStandard,
  });
  const ringOpacity = interpolate(hold, [0, 0.4, 1], [0, 0.45, 0], clamp);
  const coreLineOpacity = interpolate(
    converge,
    [0, 0.35, 0.7, 1],
    [0.06, 0.4, 0.65, 0.08],
    clamp,
  );
  const bgIntensity = interpolate(converge, [0, 1], [0.9, 1.2], clamp);

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
            <linearGradient id="sw-lane" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={tokens.accent} stopOpacity="0" />
              <stop offset="12%" stopColor={tokens.accent} stopOpacity="0.45" />
              <stop offset="50%" stopColor={tokens.accent} stopOpacity="0.95" />
              <stop offset="88%" stopColor={tokens.accent} stopOpacity="0.45" />
              <stop offset="100%" stopColor={tokens.accent} stopOpacity="0" />
            </linearGradient>
            <radialGradient id="sw-pulse" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={tokens.accent} stopOpacity="0.9" />
              <stop offset="45%" stopColor={tokens.accent} stopOpacity="0.28" />
              <stop offset="100%" stopColor={tokens.accent} stopOpacity="0" />
            </radialGradient>
            <filter id="sw-soft" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="1.4" />
            </filter>
          </defs>

          {/* Unified core under braid */}
          <line
            x1={width * 0.1}
            y1={height * 0.5}
            x2={width * 0.9}
            y2={height * 0.5}
            stroke="url(#sw-lane)"
            strokeWidth={1.4}
            opacity={coreLineOpacity}
          />

          {lanes.map((lane, i) => (
            <g key={i}>
              <path
                d={lane.d}
                fill="none"
                stroke="url(#sw-lane)"
                strokeWidth={lane.weight}
                strokeLinecap="round"
                opacity={lane.opacity * 0.4}
                strokeDasharray="3 16"
                strokeDashoffset={lane.dashOffset}
              />
              <path
                d={lane.d}
                fill="none"
                stroke="url(#sw-lane)"
                strokeWidth={lane.weight}
                strokeLinecap="round"
                opacity={lane.opacity}
              />
              <circle
                cx={lane.bead[0]}
                cy={lane.bead[1]}
                r={2 + lane.weave * 1.8}
                fill={tokens.accent}
                opacity={0.4 + lane.weave * 0.4}
              />
            </g>
          ))}

          {/* Follow-through ring on hold */}
          <circle
            cx={width * 0.5}
            cy={height * 0.5}
            r={ringR}
            fill="none"
            stroke={tokens.accent}
            strokeWidth={1.25}
            opacity={ringOpacity}
          />

          <circle
            cx={width * 0.5}
            cy={height * 0.5}
            r={pulseR * 1.6}
            fill="url(#sw-pulse)"
            opacity={pulseOpacity * 0.55}
            filter="url(#sw-soft)"
          />
          <circle
            cx={width * 0.5}
            cy={height * 0.5}
            r={pulseR}
            fill="url(#sw-pulse)"
            opacity={pulseOpacity}
          />
          <circle
            cx={width * 0.5}
            cy={height * 0.5}
            r={interpolate(converge, [0, 1], [1.5, 4.5], clamp)}
            fill={tokens.paper}
            opacity={pulseOpacity * 0.85}
          />
        </svg>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
