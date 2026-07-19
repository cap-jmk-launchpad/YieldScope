import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

const INK = "#05080f";
const INK_ELEVATED = "#0c1524";
const PAPER = "#e8eef6";
const MINT = "#00efff";
const MUTED = "#8b9bb0";

type OgImageOptions = {
  title?: string;
  subtitle?: string;
  eyebrow?: string;
};

/** Shared YieldScope Open Graph / Twitter Card image (1200×630). */
export function yieldScopeOgImage({
  title = "YieldScope",
  subtitle = "Solving scattered rewards. Track all your crypto rewards in one place",
  eyebrow = "yieldscope.d3bu7.com",
}: OgImageOptions = {}) {
  return new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: `linear-gradient(168deg, ${INK} 0%, ${INK_ELEVATED} 48%, #061018 100%)`,
          padding: "64px 72px",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        {/* Accent rail */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: 6,
            background: MINT,
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <svg
            width="56"
            height="56"
            viewBox="0 0 48 48"
            fill="none"
            style={{ flexShrink: 0 }}
          >
            <path
              d="M8 8 L8 40 L24 36 L24 12 Z M24 12 L24 36 L40 40 L40 8 Z"
              stroke={MINT}
              strokeWidth="2.5"
              fill="none"
            />
          </svg>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div
              style={{
                fontSize: 42,
                fontWeight: 700,
                color: PAPER,
                letterSpacing: "-0.03em",
                lineHeight: 1.1,
              }}
            >
              {title}
            </div>
            <div
              style={{
                fontSize: 22,
                color: MINT,
                letterSpacing: "0.02em",
              }}
            >
              {eyebrow}
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 20,
            maxWidth: 980,
          }}
        >
          <div
            style={{
              fontSize: title === "YieldScope" ? 48 : 40,
              fontWeight: 600,
              color: PAPER,
              lineHeight: 1.25,
              letterSpacing: "-0.02em",
            }}
          >
            {subtitle}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontSize: 20,
              color: MUTED,
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: MINT,
              }}
            />
            Binance · OKX · Monad · LUNC
          </div>
        </div>
      </div>
    ),
    { ...OG_SIZE }
  );
}
