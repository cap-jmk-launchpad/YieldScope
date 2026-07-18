/**
 * Resolve crypto/fiat asset logos for table cells and selectors.
 *
 * Logos live in YieldScope Supabase Storage (not in git):
 *   bucket:  asset-logos
 *   object:  {slug}.svg   (lowercase ticker / alias, e.g. btc.svg, mon.svg)
 *   public:  {SUPABASE_URL}/storage/v1/object/public/asset-logos/{slug}.svg
 *
 * Seed / refresh with: deploy/scripts/upload-asset-logos.sh
 * Missing objects → initials fallback in the React component.
 */

export const ASSET_LOGOS_BUCKET = "asset-logos";

const DEFAULT_SUPABASE_URL = "https://supabase.yieldscope.d3bu7.com";

/** Map display tickers → storage object slug when names diverge. */
const SLUG_ALIASES: Record<string, string> = {
  WETH: "eth",
  WBTC: "btc",
  BTCB: "btc",
  USD: "usd",
  EUR: "eur",
  GBP: "gbp",
  JPY: "jpy",
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

/** Storage object slug (lowercase, alphanumeric). */
export function assetIconSlug(symbol: string): string {
  const normalized = normalizeAssetSymbol(symbol);
  if (!normalized) return "generic";
  const aliased = SLUG_ALIASES[normalized] ?? normalized.toLowerCase();
  return aliased.replace(/[^a-z0-9]/g, "") || "generic";
}

export function supabasePublicUrl(): string {
  const raw =
    (typeof process !== "undefined" && process.env.NEXT_PUBLIC_SUPABASE_URL) ||
    DEFAULT_SUPABASE_URL;
  return raw.replace(/\/$/, "");
}

/** Public Supabase Storage URL for an asset logo SVG. */
export function assetIconUrl(symbol: string): string {
  const slug = assetIconSlug(symbol);
  return `${supabasePublicUrl()}/storage/v1/object/public/${ASSET_LOGOS_BUCKET}/${slug}.svg`;
}

/** @deprecated Use assetIconUrl — logos are served from Supabase Storage only. */
export function assetIconCdnUrl(symbol: string): string {
  return assetIconUrl(symbol);
}

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
