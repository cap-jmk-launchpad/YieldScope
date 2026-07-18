import { describe, expect, it } from "vitest";
import {
  ASSET_LOGOS_BUCKET,
  assetIconAlt,
  assetIconInitials,
  assetIconSlug,
  assetIconUrl,
  normalizeAssetSymbol,
  supabasePublicUrl,
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
  });

  it("builds public Supabase Storage URLs", () => {
    const base = supabasePublicUrl();
    expect(assetIconUrl("ETH")).toBe(
      `${base}/storage/v1/object/public/${ASSET_LOGOS_BUCKET}/eth.svg`,
    );
    expect(assetIconUrl("MON")).toContain(
      `/storage/v1/object/public/${ASSET_LOGOS_BUCKET}/mon.svg`,
    );
    expect(assetIconUrl("BTC")).not.toContain("cdn.jsdelivr.net");
    expect(assetIconUrl("BTC")).not.toContain("/assets/icons/");
  });

  it("provides accessible alt and initials", () => {
    expect(assetIconAlt("btc")).toBe("BTC logo");
    expect(assetIconInitials("USDT")).toBe("USD");
    expect(assetIconInitials("ETH")).toBe("ETH");
    expect(assetIconInitials("")).toBe("?");
  });
});
