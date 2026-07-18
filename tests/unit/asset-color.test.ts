import { describe, expect, it } from "vitest";
import { assetChartColor } from "../../web/src/lib/asset-color";

describe("assetChartColor", () => {
  it("returns recognizable brand colors for common assets", () => {
    expect(assetChartColor("BTC")).toBe("#F7931A");
    expect(assetChartColor("ETH")).toBe("#627EEA");
    expect(assetChartColor("MON")).toBe("#836EF9");
    expect(assetChartColor("LUNC")).toBe("#F4D03F");
    expect(assetChartColor("USDT")).toBe("#26A17B");
    expect(assetChartColor("USDC")).toBe("#2775CA");
    expect(assetChartColor("USD")).toBe("#85BB65");
    expect(assetChartColor("EUR")).toBe("#5B8DEF");
  });

  it("resolves aliases to the same brand color as the base asset", () => {
    expect(assetChartColor("WETH")).toBe(assetChartColor("ETH"));
    expect(assetChartColor("WBTC")).toBe(assetChartColor("BTC"));
    expect(assetChartColor("LUNA")).toBe(assetChartColor("LUNC"));
    expect(assetChartColor("UST")).toBe(assetChartColor("USTC"));
  });

  it("is case- and whitespace-insensitive", () => {
    expect(assetChartColor(" btc ")).toBe(assetChartColor("BTC"));
    expect(assetChartColor("Usdt")).toBe(assetChartColor("USDT"));
  });

  it("returns a stable fallback for unknown tickers", () => {
    const a = assetChartColor("ZZZUNKNOWN");
    const b = assetChartColor("zzzunknown");
    expect(a).toBe(b);
    expect(a).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("uses muted fallback for empty symbol", () => {
    expect(assetChartColor("")).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});
