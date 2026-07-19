/**
 * Brand venue icons for Connect + dashboard source lists.
 *
 * Prefer Supabase Storage (`brand-icons` bucket); fall back to local
 * `web/public/brands/{slug}.svg` via BrandIcon onError.
 *
 * Upload: `bash deploy/scripts/upload-brand-icons.sh`
 * Docs: `web/public/brands/README.md`
 */

import type { SourceId } from "@/lib/adapters/types";

export const BRAND_ICONS_BUCKET = "brand-icons";

export const BRAND_ICON_SLUGS = ["binance", "okx", "monad", "terra"] as const;
export type BrandIconSlug = (typeof BRAND_ICON_SLUGS)[number];

/** Local public path prefix (Next.js `web/public`). */
export const BRAND_ICONS_PUBLIC_DIR = "/brands";

export type ConnectionSection = "exchanges" | "wallets";

export type ConnectionBrand = {
  id: SourceId;
  slug: BrandIconSlug;
  name: string;
  section: ConnectionSection;
  hintLabel: string;
};

/** Phase 1 connection order: Exchanges then Wallets. */
export const CONNECTION_BRANDS: ConnectionBrand[] = [
  {
    id: "binance",
    slug: "binance",
    name: "Binance",
    section: "exchanges",
    hintLabel: "API key",
  },
  {
    id: "okx",
    slug: "okx",
    name: "OKX",
    section: "exchanges",
    hintLabel: "API key",
  },
  {
    id: "monad_stake",
    slug: "monad",
    name: "Monad",
    section: "wallets",
    hintLabel: "Wallet",
  },
  {
    id: "lunc_stake",
    slug: "terra",
    name: "Terra Classic",
    section: "wallets",
    hintLabel: "Address",
  },
];

export const SECTION_LABEL: Record<ConnectionSection, string> = {
  exchanges: "Exchanges",
  wallets: "Wallets",
};

export function supabasePublicBase(): string {
  const raw =
    (typeof process !== "undefined" && process.env.NEXT_PUBLIC_SUPABASE_URL) ||
    "https://supabase.yieldscope.d3bu7.com";
  return raw.replace(/\/$/, "");
}

/** Supabase Storage public URL for a brand slug. */
export function brandIconCdnUrl(slug: BrandIconSlug): string {
  return `${supabasePublicBase()}/storage/v1/object/public/${BRAND_ICONS_BUCKET}/${slug}.svg`;
}

/** Local vendored fallback. */
export function brandIconLocalUrl(slug: BrandIconSlug): string {
  return `${BRAND_ICONS_PUBLIC_DIR}/${slug}.svg`;
}

/** Prefer CDN; BrandIcon falls back to local on error. */
export function brandIconUrl(slug: BrandIconSlug): string {
  return brandIconCdnUrl(slug);
}

export function brandForSource(id: SourceId): ConnectionBrand | undefined {
  return CONNECTION_BRANDS.find((b) => b.id === id);
}

export function brandsInSection(
  section: ConnectionSection,
): ConnectionBrand[] {
  return CONNECTION_BRANDS.filter((b) => b.section === section);
}
