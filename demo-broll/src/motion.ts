/**
 * Shared motion helpers — remotion-motion-designer + motion-graphics craft.
 * Timing derives from fps; easings from theme.
 */
import { interpolate } from "remotion";
import { theme } from "./theme";

export const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

export function loopPulse(t: number): number {
  return 0.5 - 0.5 * Math.cos(t * Math.PI * 2);
}

export function wrap01(t: number): number {
  return ((t % 1) + 1) % 1;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerp2(
  a: [number, number],
  b: [number, number],
  t: number,
): [number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
}

/** Idle breathe for elements on screen >2s (motion-graphics rule 7). */
export function idleBreathe(frame: number, fps: number): number {
  return 1 + Math.sin((frame / fps) * Math.PI * 2 * 0.35) * 0.018;
}

export type StoryPhase =
  | "anticipate"
  | "converge"
  | "hold"
  | "release"
  | "settle";

/**
 * Narrative arc (motion-designer): setup → anticipation → payoff → settle.
 * Hold ≈ theme.timing.holdReadableSec at peak.
 */
export function storyProgress(t: number): {
  phase: StoryPhase;
  converge: number;
  anticipate: number;
  hold: number;
} {
  const pulse = loopPulse(t);
  const anticipate = interpolate(pulse, [0, 0.12, 0.22, 0.35], [0, 0.55, 0.15, 0], {
    ...clamp,
    easing: theme.ease.inOut,
  });
  const converge = interpolate(
    pulse,
    [0, 0.18, 0.42, 0.58, 0.82, 1],
    [0, 0.08, 0.92, 1, 0.12, 0],
    { ...clamp, easing: theme.ease.out },
  );
  const hold = interpolate(pulse, [0.38, 0.48, 0.55, 0.65], [0, 1, 1, 0], clamp);

  let phase: StoryPhase = "settle";
  if (pulse < 0.18) phase = "anticipate";
  else if (pulse < 0.42) phase = "converge";
  else if (pulse < 0.58) phase = "hold";
  else if (pulse < 0.82) phase = "release";
  else phase = "settle";

  return { phase, converge, anticipate, hold };
}

export function staggerDelay(index: number, count: number, span = 0.14): number {
  return (index / Math.max(1, count - 1)) * span;
}

export function cubicAt(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  u: number,
): [number, number] {
  const t = Math.max(0, Math.min(1, u));
  const mt = 1 - t;
  const x =
    mt * mt * mt * p0[0] +
    3 * mt * mt * t * p1[0] +
    3 * mt * t * t * p2[0] +
    t * t * t * p3[0];
  const y =
    mt * mt * mt * p0[1] +
    3 * mt * mt * t * p1[1] +
    3 * mt * t * t * p2[1] +
    t * t * t * p3[1];
  return [x, y];
}

export function cubicPath(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
): string {
  return `M ${p0[0]} ${p0[1]} C ${p1[0]} ${p1[1]}, ${p2[0]} ${p2[1]}, ${p3[0]} ${p3[1]}`;
}

/** Re-exports for compositions that previously imported from motion.ts */
export const easeExpressive = theme.ease.out;
export const easeEditorial = theme.ease.inOut;
export const easeStandard = theme.ease.standard;
