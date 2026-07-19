/**
 * Single motion theme — remotion-motion-graphics rule:
 * never inline hex / easings in components.
 */
import { Easing } from "remotion";

export const theme = {
  colors: {
    ink: "#05080f",
    inkElevated: "#0c1524",
    paper: "#e8eef6",
    accent: "#00efff",
    accentDim: "#1a6b6b",
    muted: "#8a9bb0",
  },
  ease: {
    /** Brand expressive — entrances / converge */
    out: Easing.bezier(0.16, 1, 0.3, 1),
    /** Editorial moves */
    inOut: Easing.bezier(0.45, 0, 0.55, 1),
    /** Standard product */
    standard: Easing.bezier(0.22, 1, 0.36, 1),
    /** Exits only — faster leave */
    in: Easing.bezier(0.7, 0, 0.84, 0),
  },
  spring: {
    snappy: { damping: 25, stiffness: 180, mass: 0.7 },
    buttery: { damping: 50, stiffness: 50, mass: 1 },
    heavy: { damping: 30, stiffness: 80, mass: 2.2 },
  },
  /** Timing tokens in seconds — convert with fps */
  timing: {
    staggerSec: 0.08,
    holdReadableSec: 1.2,
    exitFasterThanEnter: 0.55,
  },
  video: {
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: 300,
  },
} as const;

/** @deprecated prefer theme.colors — kept for existing imports */
export const tokens = theme.colors;
export const VIDEO = theme.video;
