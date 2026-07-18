"use client";

import { useState } from "react";
import {
  assetIconAlt,
  assetIconInitials,
  assetIconUrl,
  normalizeAssetSymbol,
  type AssetIconSize,
} from "@/lib/asset-icon";

export interface AssetIconProps {
  /** Ticker / currency code (BTC, ETH, USDT, MON, …). */
  symbol: string;
  size?: AssetIconSize;
  className?: string;
  /** When false, hide the ticker text (icon only). Default true for table cells. */
  showLabel?: boolean;
}

const SIZE_PX: Record<AssetIconSize, number> = {
  sm: 16,
  md: 20,
  lg: 28,
};

/**
 * Recognizable asset logo with accessible alt text and initials fallback.
 * Alias: `CurrencyLogo` — same component for display-currency selectors.
 */
export function AssetIcon({
  symbol,
  size = "md",
  className,
  showLabel = true,
}: AssetIconProps) {
  const [failed, setFailed] = useState(false);
  const normalized = normalizeAssetSymbol(symbol);
  const px = SIZE_PX[size];
  const src = assetIconUrl(normalized);
  const alt = assetIconAlt(normalized);
  const initials = assetIconInitials(normalized);

  return (
    <span
      className={["asset-icon", `asset-icon--${size}`, className]
        .filter(Boolean)
        .join(" ")}
    >
      {failed || !normalized ? (
        <span
          className="asset-icon__fallback"
          style={{ width: px, height: px, fontSize: Math.max(9, px * 0.45) }}
          aria-hidden={showLabel ? true : undefined}
          role={showLabel ? undefined : "img"}
          aria-label={showLabel ? undefined : alt}
          title={normalized || undefined}
        >
          {initials}
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL + onError fallback
        <img
          className="asset-icon__img"
          src={src}
          alt={alt}
          width={px}
          height={px}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      )}
      {showLabel ? (
        <span className="asset-icon__label">{normalized || symbol}</span>
      ) : null}
    </span>
  );
}

/** Alias for display-currency / fiat selectors — same as AssetIcon. */
export const CurrencyLogo = AssetIcon;

/** Table cell helper: logo + ticker. */
export function CurrencyCell({
  symbol,
  size = "md",
}: {
  symbol: string;
  size?: AssetIconSize;
}) {
  return <AssetIcon symbol={symbol} size={size} showLabel />;
}
