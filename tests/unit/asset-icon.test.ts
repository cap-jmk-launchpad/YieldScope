import { describe, expect, it } from "vitest";
import {
  ASSET_TOKENS_PUBLIC_DIR,
  VENDORED_ASSET_SLUGS,
  assetIconAlt,
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

  it("maps aliases to storage slugs", () => {
    expect(assetIconSlug("BTC")).toBe("btc");
    expect(assetIconSlug("LUNC")).toBe("lunc");
    expect(assetIconSlug("USTC")).toBe("ustc");
    expect(assetIconSlug("WETH")).toBe("eth");
    expect(assetIconSlug("EUR")).toBe("eur");
    expect(assetIconSlug("MON")).toBe("mon");
    expect(assetIconSlug("POL")).toBe("matic");
    expect(assetIconSlug("WBTC")).toBe("btc");
  });

  it("builds local public asset URLs", () => {
    expect(assetIconUrl("ETH")).toBe(`${ASSET_TOKENS_PUBLIC_DIR}/eth.svg`);
    expect(assetIconUrl("MON")).toBe(`${ASSET_TOKENS_PUBLIC_DIR}/mon.svg`);
    expect(assetIconUrl("BTC")).not.toContain("cdn.jsdelivr.net");
    expect(assetIconUrl("BTC")).not.toContain("supabase");
    expect(assetIconUrl("BTC")).toContain("/assets/tokens/");
  });

  it("lists vendored slugs used by the UI", () => {
    expect(VENDORED_ASSET_SLUGS).toContain("btc");
    expect(VENDORED_ASSET_SLUGS).toContain("mon");
    expect(VENDORED_ASSET_SLUGS).toContain("lunc");
    expect(VENDORED_ASSET_SLUGS).toContain("usdt");
  });

  it("provides accessible alt and initials", () => {
    expect(assetIconAlt("btc")).toBe("BTC logo");
    expect(assetIconInitials("USDT")).toBe("USD");
    expect(assetIconInitials("ETH")).toBe("ETH");
    expect(assetIconInitials("")).toBe("?");
  });
});
