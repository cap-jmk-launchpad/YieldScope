import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { theme } from "../theme";

/**
 * Five-layer polish (remotion-motion-graphics):
 * grade → grain → vignette sit ABOVE graphics.
 * YieldScope: cyan soft-light grade, very light grain, dusk vignette.
 */

export const ColorGrade: React.FC = () => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    <AbsoluteFill
      style={{
        backgroundColor: theme.colors.accent,
        mixBlendMode: "soft-light",
        opacity: 0.12,
      }}
    />
    <AbsoluteFill
      style={{
        background:
          "linear-gradient(180deg, rgba(5,8,15,0.22) 0%, transparent 28%, transparent 72%, rgba(5,8,15,0.35) 100%)",
      }}
    />
  </AbsoluteFill>
);

export const FilmGrain: React.FC = () => {
  const frame = useCurrentFrame();
  const noise = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='220' height='220' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`;
  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        backgroundImage: noise,
        backgroundSize: "220px",
        backgroundPosition: `${(frame * 7) % 220}px ${(frame * 13) % 220}px`,
        opacity: 0.045,
        mixBlendMode: "overlay",
      }}
    />
  );
};

export const Vignette: React.FC = () => (
  <AbsoluteFill
    style={{
      pointerEvents: "none",
      background:
        "radial-gradient(ellipse at center, transparent 52%, rgba(5,8,15,0.55) 100%)",
    }}
  />
);

/** Stack polish layers on top of a scene. */
export const PolishStack: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <AbsoluteFill>
    {children}
    <ColorGrade />
    <FilmGrain />
    <Vignette />
  </AbsoluteFill>
);
