/**
 * Chart / legend fills keyed by asset brand (or a stable hash fallback).
 * Tuned for contrast on YieldScope dark ink (`#05080f` / `#0c1524`).
 */

import { assetIconSlug, normalizeAssetSymbol } from "@/lib/asset-icon";

/**
 * Brand colors by storage slug (after alias resolution: WETH→eth, LUNA→lunc, …).
 * Values match common token branding / our custom logo fills where possible.
 */
const BRAND_BY_SLUG: Record<string, string> = {
  btc: "#F7931A",
  eth: "#627EEA",
  mon: "#836EF9",
  /** Gold from LUNC logo — navy fill is too dark on ink. */
  lunc: "#F4D03F",
  ustc: "#5493F7",
  usdt: "#26A17B",
  usdc: "#2775CA",
  busd: "#F0B90B",
  fdusd: "#A0E7B0",
  tusd: "#2E7DFF",
  usde: "#5B8DEF",
  dai: "#F5AC37",
  usd: "#85BB65",
  /** Lifted from EU blue for dark-UI contrast. */
  eur: "#5B8DEF",
  gbp: "#E11D48",
  jpy: "#BC002D",
  bnb: "#F3BA2F",
  /** Solana green — distinct from MON purple. */
  sol: "#14F195",
  xrp: "#00AAE4",
  ada: "#3468D8",
  doge: "#C2A633",
  link: "#2A5ADA",
  avax: "#E84142",
  dot: "#E6007A",
  atom: "#6B7AED",
  trx: "#FF3344",
  matic: "#8247E5",
  pol: "#8247E5",
};

/** Muted YieldScope-adjacent palette when the asset has no brand entry. */
const FALLBACK_PALETTE = [
  "#6eb5ff",
  "#f0a060",
  "#e07a5f",
  "#8a9bb0",
  "#c4d4e8",
  "#ff8f70",
  "#5ad4a8",
  "#a8b4ff",
] as const;

function hashIndex(key: string, modulo: number): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % modulo;
}

/** Deterministic muted-palette color for unknown tickers. */
function fallbackChartColor(key: string): string {
  const idx = hashIndex(key, FALLBACK_PALETTE.length);
  return FALLBACK_PALETTE[idx]!;
}

/**
 * Resolve a pie-slice / legend swatch color for an asset or fiat ticker.
 * Aliases (WETH, WBTC, LUNA, …) follow {@link assetIconSlug}.
 */
export function assetChartColor(symbol: string): string {
  const normalized = normalizeAssetSymbol(symbol);
  if (!normalized) return FALLBACK_PALETTE[3]!;

  const slug = assetIconSlug(normalized);
  const brand = BRAND_BY_SLUG[slug];
  if (brand) return brand;

  return fallbackChartColor(normalized);
}
