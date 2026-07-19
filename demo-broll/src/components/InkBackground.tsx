import React from "react";
import { AbsoluteFill } from "remotion";
import { tokens } from "../tokens";

export const InkBackground: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: tokens.ink,
        backgroundImage: [
          `radial-gradient(ellipse 70% 55% at 50% 42%, ${tokens.inkElevated} 0%, transparent 70%)`,
          `radial-gradient(ellipse 40% 30% at 50% 50%, ${tokens.accent}10 0%, transparent 65%)`,
          `linear-gradient(180deg, ${tokens.ink} 0%, ${tokens.inkElevated} 100%)`,
        ].join(", "),
      }}
    >
      {/* Subtle instrument-panel grid — opacity only, no glow bloom */}
      <AbsoluteFill
        style={{
          opacity: 0.07,
          backgroundImage: `
            linear-gradient(${tokens.muted} 1px, transparent 1px),
            linear-gradient(90deg, ${tokens.muted} 1px, transparent 1px)
          `,
          backgroundSize: "80px 80px",
          backgroundPosition: "center center",
        }}
      />
      {/* Soft scan lines */}
      <AbsoluteFill
        style={{
          opacity: 0.04,
          backgroundImage: `repeating-linear-gradient(
            0deg,
            transparent,
            transparent 3px,
            ${tokens.paper}08 3px,
            ${tokens.paper}08 4px
          )`,
        }}
      />
    </AbsoluteFill>
  );
};
