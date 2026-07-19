/**
 * Ocean-like procedural waves for YieldScope B-roll.
 * Inspired by layered swell/sea/chop (Gerstner-lite) used in
 * particle-wave motion graphics — not a single sine ribbon.
 */

export type OceanSample = {
  /** Surface height relative to baseline (px, signed) */
  height: number;
  /** 0–1 crest emphasis for particles / opacity */
  crest: number;
  /** Approximate slope for lean/tilt of blocks */
  slope: number;
};

/** Three-layer ocean: swell + sea + chop. All periods wrap for seamless loops. */
export function oceanHeight(
  xNorm: number,
  t: number,
  opts?: {
    swellAmp?: number;
    seaAmp?: number;
    chopAmp?: number;
    scale?: number;
  },
): OceanSample {
  const swellAmp = opts?.swellAmp ?? 1;
  const seaAmp = opts?.seaAmp ?? 1;
  const chopAmp = opts?.chopAmp ?? 1;
  const scale = opts?.scale ?? 1;

  const x = xNorm * Math.PI * 2;

  // Swell — long, heavy, slow (ocean body)
  const swell =
    Math.sin(x * 1.15 + t * Math.PI * 2) * 0.55 * swellAmp +
    Math.sin(x * 0.55 - t * Math.PI * 2 * 0.35) * 0.28 * swellAmp;

  // Sea — medium roll
  const sea =
    Math.sin(x * 2.4 + t * Math.PI * 2 * 1.15 + 1.2) * 0.32 * seaAmp +
    Math.sin(x * 3.1 - t * Math.PI * 2 * 0.7 + 0.4) * 0.18 * seaAmp;

  // Chop — short surface detail
  const chop =
    Math.sin(x * 6.2 + t * Math.PI * 2 * 2.1 + 2.1) * 0.1 * chopAmp +
    Math.sin(x * 9.5 - t * Math.PI * 2 * 1.6) * 0.05 * chopAmp;

  const height = (swell + sea + chop) * scale;

  // Crest factor: peaks get brighter particles
  const crest = Math.max(0, Math.min(1, (height / (scale * 0.9) + 0.35) * 0.85));

  // Finite-difference slope for block lean
  const eps = 0.004;
  const h2 = oceanHeightRaw(xNorm + eps, t, swellAmp, seaAmp, chopAmp) * scale;
  const slope = (h2 - height) / (eps * 400);

  return { height, crest, slope };
}

function oceanHeightRaw(
  xNorm: number,
  t: number,
  swellAmp: number,
  seaAmp: number,
  chopAmp: number,
): number {
  const x = xNorm * Math.PI * 2;
  const swell =
    Math.sin(x * 1.15 + t * Math.PI * 2) * 0.55 * swellAmp +
    Math.sin(x * 0.55 - t * Math.PI * 2 * 0.35) * 0.28 * swellAmp;
  const sea =
    Math.sin(x * 2.4 + t * Math.PI * 2 * 1.15 + 1.2) * 0.32 * seaAmp +
    Math.sin(x * 3.1 - t * Math.PI * 2 * 0.7 + 0.4) * 0.18 * seaAmp;
  const chop =
    Math.sin(x * 6.2 + t * Math.PI * 2 * 2.1 + 2.1) * 0.1 * chopAmp +
    Math.sin(x * 9.5 - t * Math.PI * 2 * 1.6) * 0.05 * chopAmp;
  return swell + sea + chop;
}

/** Sample a Gerstner-ish horizontal drift for particles riding the surface. */
export function oceanDrift(xNorm: number, t: number): number {
  return (
    Math.sin(xNorm * Math.PI * 2 * 1.15 + t * Math.PI * 2) * 0.012 +
    Math.sin(xNorm * Math.PI * 2 * 2.4 + t * Math.PI * 2 * 1.15) * 0.006
  );
}
