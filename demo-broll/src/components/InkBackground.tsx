import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { clamp, easeEditorial, loopPulse, wrap01 } from "../motion";
import { tokens } from "../theme";

/**
 * Instrument-panel dusk field: layered depth, slow ambient drift,
 * secondary action only (never competes with hero geometry).
 */
export const InkBackground: React.FC<{ intensity?: number }> = ({
  intensity = 1,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  const t = frame / durationInFrames;
  const breathe = loopPulse(t);
  const drift = wrap01(t);

  const washA = interpolate(breathe, [0, 1], [0.04, 0.11], clamp) * intensity;
  const washB = interpolate(breathe, [0, 1], [0.03, 0.07], clamp) * intensity;
  const gridOpacity = 0.055 + breathe * 0.025 * intensity;
  const gridShiftX = Math.sin(drift * Math.PI * 2) * 12;
  const gridShiftY = Math.cos(drift * Math.PI * 2) * 8;
  const scanOpacity = 0.035 + breathe * 0.015;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: tokens.ink,
        backgroundImage: [
          `radial-gradient(ellipse 55% 42% at ${48 + Math.sin(drift * Math.PI * 2) * 3}% ${40 + Math.cos(drift * Math.PI * 2) * 2}%, ${tokens.inkElevated} 0%, transparent 72%)`,
          `radial-gradient(ellipse 38% 28% at 50% 50%, rgba(0,239,255,${washA}) 0%, transparent 68%)`,
          `radial-gradient(ellipse 70% 50% at 20% 80%, rgba(26,107,107,${washB}) 0%, transparent 60%)`,
          `linear-gradient(165deg, ${tokens.ink} 0%, ${tokens.inkElevated} 55%, ${tokens.ink} 100%)`,
        ].join(", "),
      }}
    >
      <AbsoluteFill
        style={{
          opacity: gridOpacity,
          backgroundImage: `
            linear-gradient(${tokens.muted} 1px, transparent 1px),
            linear-gradient(90deg, ${tokens.muted} 1px, transparent 1px)
          `,
          backgroundSize: "72px 72px",
          backgroundPosition: `${gridShiftX}px ${gridShiftY}px`,
        }}
      />
      {/* Horizon guide — secondary staging line */}
      <AbsoluteFill
        style={{
          opacity: interpolate(breathe, [0, 1], [0.04, 0.09], {
            ...clamp,
            easing: easeEditorial,
          }),
          backgroundImage: `linear-gradient(90deg, transparent 8%, ${tokens.accent}22 35%, ${tokens.accent}33 50%, ${tokens.accent}22 65%, transparent 92%)`,
          backgroundSize: "100% 1px",
          backgroundRepeat: "no-repeat",
          backgroundPosition: `center ${height * 0.5}px`,
        }}
      />
      <AbsoluteFill
        style={{
          opacity: scanOpacity,
          backgroundImage: `repeating-linear-gradient(
            0deg,
            transparent,
            transparent 3px,
            rgba(232,238,246,0.04) 3px,
            rgba(232,238,246,0.04) 4px
          )`,
          width,
        }}
      />
      {/* Soft vignette for instrument focus */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 75% 70% at 50% 50%, transparent 45%, ${tokens.ink}cc 100%)`,
          opacity: 0.55,
        }}
      />
    </AbsoluteFill>
  );
};
