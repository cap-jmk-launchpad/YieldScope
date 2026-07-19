import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { InkBackground } from "../components/InkBackground";
import { tokens } from "../tokens";

type Lane = {
  yNorm: number;
  amp: number;
  phase: number;
  weight: number;
};

/** Four unnamed source lanes — geometry only, no labels. */
const LANES: Lane[] = [
  { yNorm: 0.32, amp: 48, phase: 0, weight: 1.8 },
  { yNorm: 0.42, amp: 38, phase: 0.7, weight: 2.2 },
  { yNorm: 0.58, amp: 42, phase: 1.4, weight: 1.6 },
  { yNorm: 0.68, amp: 36, phase: 2.1, weight: 2.0 },
];

function loopPulse(t: number): number {
  return 0.5 - 0.5 * Math.cos(t * Math.PI * 2);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lanePath(
  width: number,
  height: number,
  lane: Lane,
  weave: number,
  travel: number,
): string {
  const baseY = lane.yNorm * height;
  const targetY = height * 0.5;
  const points: string[] = [];
  const steps = 64;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const x = u * width;
    // Horizontal travel phase for living motion (seamless via sin)
    const wave =
      Math.sin(u * Math.PI * 3 + lane.phase + travel * Math.PI * 2) *
      lane.amp *
      (1 - weave * 0.85);
    const y = lerp(baseY + wave, targetY, Easing.inOut(Easing.cubic)(weave));
    points.push(i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`);
  }
  return points.join(" ");
}

/**
 * V2 — Multiple source lanes weave into one central earn pulse, then open again.
 * Seamless 10s loop.
 */
export const SourceWeave: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const t = frame / durationInFrames;
  const weave = loopPulse(t);
  const travel = t; // full-period wrap → seamless

  const pulseR = interpolate(weave, [0, 1], [4, 18], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const pulseOpacity = interpolate(weave, [0, 0.35, 0.7, 1], [0.2, 0.75, 0.9, 0.2], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const coreLineOpacity = interpolate(weave, [0, 0.4, 0.75, 1], [0.1, 0.55, 0.7, 0.1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

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
            <linearGradient id="weaveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={tokens.accent} stopOpacity="0" />
              <stop offset="15%" stopColor={tokens.accent} stopOpacity="0.55" />
              <stop offset="50%" stopColor={tokens.accent} stopOpacity="0.95" />
              <stop offset="85%" stopColor={tokens.accent} stopOpacity="0.55" />
              <stop offset="100%" stopColor={tokens.accent} stopOpacity="0" />
            </linearGradient>
            <radialGradient id="pulseGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={tokens.accent} stopOpacity="0.85" />
              <stop offset="55%" stopColor={tokens.accent} stopOpacity="0.25" />
              <stop offset="100%" stopColor={tokens.accent} stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Unified core line under weave */}
          <line
            x1={width * 0.12}
            y1={height * 0.5}
            x2={width * 0.88}
            y2={height * 0.5}
            stroke="url(#weaveGrad)"
            strokeWidth={1.5}
            opacity={coreLineOpacity}
          />

          {LANES.map((lane, i) => {
            const opacity = interpolate(
              weave,
              [0, 0.3, 0.7, 1],
              [0.35 + i * 0.05, 0.65, 0.45, 0.35 + i * 0.05],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            );
            return (
              <path
                key={i}
                d={lanePath(width, height, lane, weave, travel)}
                fill="none"
                stroke="url(#weaveGrad)"
                strokeWidth={lane.weight}
                strokeLinecap="round"
                opacity={opacity}
              />
            );
          })}

          {/* Single earn pulse at center when woven */}
          <circle
            cx={width * 0.5}
            cy={height * 0.5}
            r={pulseR}
            fill="url(#pulseGrad)"
            opacity={pulseOpacity}
          />
          <circle
            cx={width * 0.5}
            cy={height * 0.5}
            r={interpolate(weave, [0, 1], [2, 5])}
            fill={tokens.accent}
            opacity={pulseOpacity * 0.9}
          />
        </svg>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
