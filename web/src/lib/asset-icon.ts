/**
 * Resolve crypto/fiat asset logos for table cells and selectors.
 *
 * Logos are vendored under `web/public/assets/tokens/{slug}.svg` (≈0.2–4 KB each).
 * Refresh / re-download: `node scripts/refresh-asset-logos.mjs`
 *
 * Mapping + sources: `web/public/assets/tokens/README.md`
 * Missing objects → initials + brand-color circle fallback in the React component.
 */

/** Public path prefix served by Next.js from `web/public`. */
export const ASSET_TOKENS_PUBLIC_DIR = "/assets/tokens";

/** @deprecated Kept for tests / deploy scripts that still mention the bucket name. */
export const ASSET_LOGOS_BUCKET = "asset-logos";

/**
 * Map display tickers → storage object slug when names diverge.
 * Dedupes wrapped / legacy tickers onto one logo file.
 */
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
  /** Polygon rebrand — same mark as MATIC. */
  POL: "matic",
};

/**
 * Deduped slugs we ship under `public/assets/tokens/`.
 * Keep in sync with the refresh script + README.
 */
export const VENDORED_ASSET_SLUGS = [
  "ada",
  "atom",
  "avax",
  "bnb",
  "btc",
  "busd",
  "dai",
  "doge",
  "dot",
  "eth",
  "eur",
  "fdusd",
  "gbp",
  "generic",
  "jpy",
  "link",
  "lunc",
  "matic",
  "mon",
  "sol",
  "trx",
  "tusd",
  "usd",
  "usdc",
  "usde",
  "usdt",
  "ustc",
  "xrp",
] as const;

export type VendoredAssetSlug = (typeof VENDORED_ASSET_SLUGS)[number];

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

/** Local public URL for a vendored SVG (preferred). */
export function assetIconUrl(symbol: string): string {
  const slug = assetIconSlug(symbol);
  return `${ASSET_TOKENS_PUBLIC_DIR}/${slug}.svg`;
}

/**
 * Optional remote fallback (Supabase Storage) — unused by the UI after
 * local vendoring, kept for the legacy upload script.
 */
export function supabasePublicUrl(): string {
  const raw =
    (typeof process !== "undefined" && process.env.NEXT_PUBLIC_SUPABASE_URL) ||
    "https://supabase.yieldscope.d3bu7.com";
  return raw.replace(/\/$/, "");
}

/** @deprecated Use assetIconUrl — logos are served from local public assets. */
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
