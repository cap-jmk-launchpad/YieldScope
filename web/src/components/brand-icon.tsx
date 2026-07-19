"use client";

import { useState } from "react";
import {
  brandIconCdnUrl,
  brandIconLocalUrl,
  type BrandIconSlug,
} from "@/lib/brand-icon";

export type BrandIconSize = "sm" | "md" | "lg";

const SIZE_PX: Record<BrandIconSize, number> = {
  sm: 20,
  md: 28,
  lg: 36,
};

export function BrandIcon({
  slug,
  alt,
  size = "md",
  className,
}: {
  slug: BrandIconSlug;
  alt: string;
  size?: BrandIconSize;
  className?: string;
}) {
  const [src, setSrc] = useState(brandIconCdnUrl(slug));
  const [failedLocal, setFailedLocal] = useState(false);
  const px = SIZE_PX[size];

  if (failedLocal) {
    return (
      <span
        className={["brand-icon", "brand-icon--fallback", className]
          .filter(Boolean)
          .join(" ")}
        style={{ width: px, height: px, fontSize: Math.max(9, px * 0.4) }}
        role="img"
        aria-label={alt}
        title={alt}
      >
        {alt.slice(0, 2).toUpperCase()}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- CDN + local fallback
    <img
      className={["brand-icon", `brand-icon--${size}`, className]
        .filter(Boolean)
        .join(" ")}
      src={src}
      alt={alt}
      width={px}
      height={px}
      loading="lazy"
      decoding="async"
      onError={() => {
        const local = brandIconLocalUrl(slug);
        if (src !== local) {
          setSrc(local);
        } else {
          setFailedLocal(true);
        }
      }}
    />
  );
}
