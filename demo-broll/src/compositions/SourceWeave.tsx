import React, { useMemo } from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { InkBackground } from "../components/InkBackground";
import { clamp, easeExpressive, lerp, storyProgress, wrap01 } from "../motion";
import { oceanDrift, oceanHeight } from "../ocean";
import { tokens } from "../tokens";

const COLS = 96;
const PARTICLE_ROWS = 3;

/**
 * V2 — Ocean source field as vertical blocks + crest particles.
 * Design: instrument-panel “digital sea” — discrete bars sample a multi-layer
 * swell/sea/chop surface; particles ride crests. Story still weaves to one pulse.
 */
export const SourceWeave: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const t = frame / durationInFrames;
  const { converge, anticipate, hold } = storyProgress(t);
  const travel = wrap01(t);

  const baseline = height * 0.52;
  const marginX = width * 0.06;
  const usableW = width - marginX * 2;
  const gap = 3;
  const colW = (usableW - gap * (COLS - 1)) / COLS;
  const maxAmp = height * 0.22;

  // Weave: ocean amp collapses toward a calm center line → pulse
  const oceanScale = interpolate(converge, [0, 1], [1, 0.08], {
    ...clamp,
    easing: easeExpressive,
  });
  const spread = 1 + anticipate * 0.35;
  const calmPull = easeExpressive(converge);

  const columns = useMemo(() => {
    const out: Array<{
      x: number;
      top: number;
      h: number;
      opacity: number;
      lean: number;
      crest: number;
    }> = [];

    for (let i = 0; i < COLS; i++) {
      const u = (i + 0.5) / COLS;
      const sample = oceanHeight(u, travel, {
        swellAmp: 1.05 * spread,
        seaAmp: 1 * spread,
        chopAmp: 0.9 + anticipate * 0.4,
        scale: maxAmp * oceanScale,
      });

      // Lateral gather toward center as weave locks (sources → one)
      const xNatural = marginX + i * (colW + gap);
      const xCenter = width * 0.5 - colW / 2;
      const x = lerp(xNatural, xCenter, calmPull * 0.55);

      const barH = Math.max(4, Math.abs(sample.height) * 0.55 + maxAmp * 0.12 * (1 - calmPull));
      // Ocean surface: bars grow upward from a trough baseline
      const surfaceY = baseline - sample.height * (1 - calmPull * 0.85);
      const top = surfaceY - barH * 0.15;
      const h = barH + sample.height * 0.2 * (1 - calmPull);

      const depthFade = 0.35 + sample.crest * 0.55;
      const opacity = interpolate(
        converge,
        [0, 0.4, 0.75, 1],
        [depthFade, depthFade * 1.05, 0.45, 0.2],
        clamp,
      );

      out.push({
        x,
        top: top - h * 0.5,
        h: Math.max(6, h),
        opacity,
        lean: sample.slope * (1 - calmPull) * 8,
        crest: sample.crest,
      });
    }
    return out;
  }, [
    travel,
    maxAmp,
    oceanScale,
    spread,
    anticipate,
    calmPull,
    converge,
    marginX,
    colW,
    gap,
    baseline,
    width,
  ]);

  const particles = useMemo(() => {
    const pts: Array<{ x: number; y: number; r: number; o: number }> = [];
    const count = 56;
    for (let i = 0; i < count; i++) {
      const row = i % PARTICLE_ROWS;
      const u0 = (i / count + travel * 0.08 * (row + 1)) % 1;
      const drift = oceanDrift(u0, travel);
      const u = (u0 + drift + 1) % 1;
      const sample = oceanHeight(u, travel, {
        swellAmp: 1.05 * spread,
        seaAmp: 1 * spread,
        chopAmp: 1,
        scale: maxAmp * oceanScale,
      });
      const xNatural = marginX + u * usableW;
      const x = lerp(xNatural, width * 0.5, calmPull * 0.55);
      const y =
        baseline -
        sample.height * (1 - calmPull * 0.85) -
        row * 7 -
        sample.crest * 6;
      const o =
        (0.2 + sample.crest * 0.65) *
        interpolate(converge, [0, 0.5, 1], [1, 0.9, 0.25], clamp);
      pts.push({
        x,
        y,
        r: 1.2 + sample.crest * 2.2 - row * 0.25,
        o,
      });
    }
    return pts;
  }, [
    travel,
    spread,
    maxAmp,
    oceanScale,
    calmPull,
    converge,
    marginX,
    usableW,
    baseline,
    width,
  ]);

  const pulseR = interpolate(converge, [0, 0.55, 1], [2, 22, 6], {
    ...clamp,
    easing: easeExpressive,
  });
  const pulseOpacity = interpolate(
    converge,
    [0, 0.35, 0.55, 0.85, 1],
    [0.08, 0.55, 0.95, 0.35, 0.1],
    clamp,
  );
  const ringR = interpolate(hold, [0, 1], [10, 48], clamp);
  const ringOpacity = interpolate(hold, [0, 0.35, 1], [0, 0.4, 0], clamp);
  const foamLineOpacity = interpolate(converge, [0, 0.3, 0.7, 1], [0.15, 0.35, 0.2, 0.05], clamp);

  return (
    <AbsoluteFill>
      <InkBackground intensity={interpolate(converge, [0, 1], [0.95, 1.2], clamp)} />
      <AbsoluteFill>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          style={{ position: "absolute", inset: 0 }}
        >
          <defs>
            <linearGradient id="ow-bar" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={tokens.paper} stopOpacity="0.85" />
              <stop offset="35%" stopColor={tokens.accent} stopOpacity="0.9" />
              <stop offset="100%" stopColor={tokens.accentDim} stopOpacity="0.25" />
            </linearGradient>
            <linearGradient id="ow-foam" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={tokens.accent} stopOpacity="0" />
              <stop offset="50%" stopColor={tokens.accent} stopOpacity="0.5" />
              <stop offset="100%" stopColor={tokens.accent} stopOpacity="0" />
            </linearGradient>
            <radialGradient id="ow-pulse" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={tokens.accent} stopOpacity="0.95" />
              <stop offset="50%" stopColor={tokens.accent} stopOpacity="0.25" />
              <stop offset="100%" stopColor={tokens.accent} stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Quiet horizon foam line */}
          <line
            x1={marginX}
            y1={baseline}
            x2={width - marginX}
            y2={baseline}
            stroke="url(#ow-foam)"
            strokeWidth={1}
            opacity={foamLineOpacity}
          />

          {/* Block wave field */}
          {columns.map((c, i) => (
            <rect
              key={i}
              x={c.x}
              y={c.top}
              width={Math.max(2, colW)}
              height={c.h}
              rx={Math.min(3, colW / 2)}
              fill="url(#ow-bar)"
              opacity={c.opacity}
              transform={`rotate(${c.lean} ${c.x + colW / 2} ${c.top + c.h / 2})`}
            />
          ))}

          {/* Crest particles */}
          {particles.map((p, i) => (
            <circle
              key={`p-${i}`}
              cx={p.x}
              cy={p.y}
              r={p.r}
              fill={tokens.accent}
              opacity={p.o}
            />
          ))}

          <circle
            cx={width * 0.5}
            cy={baseline}
            r={ringR}
            fill="none"
            stroke={tokens.accent}
            strokeWidth={1.2}
            opacity={ringOpacity}
          />
          <circle
            cx={width * 0.5}
            cy={baseline}
            r={pulseR}
            fill="url(#ow-pulse)"
            opacity={pulseOpacity}
          />
          <circle
            cx={width * 0.5}
            cy={baseline}
            r={interpolate(converge, [0, 1], [1.5, 4], clamp)}
            fill={tokens.paper}
            opacity={pulseOpacity * 0.9}
          />
        </svg>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
