/**
 * Resolve crypto/fiat asset logos for table cells and selectors.
 *
 * Primary CDN: cryptocurrency-icons via jsDelivr. Unknown / missing pack icons
 * fall back to initials in the React component. Local overrides live under
 * /public/assets/icons/{slug}.svg (MON, LUNC, USTC, …).
 */

const ICON_CDN =
  "https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color";

/** Map display tickers → CDN or local slug when names diverge. */
const SLUG_ALIASES: Record<string, string> = {
  // Common wrapped / stable aliases → pack slugs
  WETH: "eth",
  WBTC: "btc",
  BTCB: "btc",
  // Fiat (present in cryptocurrency-icons)
  USD: "usd",
  EUR: "eur",
  GBP: "gbp",
  JPY: "jpy",
  // Local SVGs (not in the pack, or pack name differs)
  MON: "mon",
  LUNC: "lunc",
  LUNA: "lunc",
  USTC: "ustc",
  UST: "ustc",
};

export type AssetIconSize = "sm" | "md" | "lg";

export function normalizeAssetSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

/** CDN / local filename slug (lowercase). */
export function assetIconSlug(symbol: string): string {
  const normalized = normalizeAssetSymbol(symbol);
  if (!normalized) return "generic";
  const aliased = SLUG_ALIASES[normalized] ?? normalized.toLowerCase();
  return aliased.replace(/[^a-z0-9]/g, "") || "generic";
}

/** Prefer local SVG when we ship one; else cryptocurrency-icons CDN. */
export function assetIconUrl(symbol: string): string {
  const slug = assetIconSlug(symbol);
  if (LOCAL_ICON_SLUGS.has(slug)) {
    return `/assets/icons/${slug}.svg`;
  }
  return assetIconCdnUrl(symbol);
}

export function assetIconCdnUrl(symbol: string): string {
  return `${ICON_CDN}/${assetIconSlug(symbol)}.svg`;
}

/** Symbols we ship under web/public/assets/icons/. */
const LOCAL_ICON_SLUGS = new Set(["mon", "lunc", "ustc"]);

/** Up to 3 chars for the initials fallback chip. */
export function assetIconInitials(symbol: string): string {
  const normalized = normalizeAssetSymbol(symbol);
  if (!normalized) return "?";
  return normalized.slice(0, Math.min(3, normalized.length));
}

export function assetIconAlt(symbol: string): string {
  const normalized = normalizeAssetSymbol(symbol);
  return normalized ? `${normalized} logo` : "Asset logo";
}
