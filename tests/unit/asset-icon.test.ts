import { describe, expect, it } from "vitest";
import {
  assetIconAlt,
  assetIconCdnUrl,
  assetIconInitials,
  assetIconSlug,
  assetIconUrl,
  normalizeAssetSymbol,
} from "../../web/src/lib/asset-icon";

describe("asset-icon helpers", () => {
  it("normalizes symbols", () => {
    expect(normalizeAssetSymbol(" btc ")).toBe("BTC");
    expect(normalizeAssetSymbol("Usdt")).toBe("USDT");
  });

  it("maps aliases to CDN slugs", () => {
    expect(assetIconSlug("BTC")).toBe("btc");
    expect(assetIconSlug("LUNC")).toBe("lunc");
    expect(assetIconSlug("USTC")).toBe("ustc");
    expect(assetIconSlug("WETH")).toBe("eth");
    expect(assetIconSlug("EUR")).toBe("eur");
    expect(assetIconSlug("MON")).toBe("mon");
  });

  it("builds CDN URLs for pack icons", () => {
    expect(assetIconCdnUrl("ETH")).toBe(
      "https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/eth.svg",
    );
    expect(assetIconCdnUrl("BTC")).toContain("/btc.svg");
  });

  it("prefers local SVG for Monad / Terra Classic", () => {
    expect(assetIconUrl("MON")).toBe("/assets/icons/mon.svg");
    expect(assetIconUrl("LUNC")).toBe("/assets/icons/lunc.svg");
    expect(assetIconUrl("USTC")).toBe("/assets/icons/ustc.svg");
    expect(assetIconUrl("BTC")).toContain("cdn.jsdelivr.net");
  });

  it("provides accessible alt and initials", () => {
    expect(assetIconAlt("btc")).toBe("BTC logo");
    expect(assetIconInitials("USDT")).toBe("USD");
    expect(assetIconInitials("ETH")).toBe("ETH");
    expect(assetIconInitials("")).toBe("?");
  });
});
