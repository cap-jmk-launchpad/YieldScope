import { describe, expect, it } from "vitest";
import { TRACKED_SYMBOLS } from "../../web/src/lib/prices/binance-klines";
import {
  auditPriceCoverage,
  symbolsToTrack,
  uniqueAssets,
  usdtPairsForAssets,
} from "../../web/src/lib/prices/missing-symbols";

describe("missing-symbols audit", () => {
  it("dedupes and normalizes assets", () => {
    expect(uniqueAssets(["btc", "BTC", " eth ", ""])).toEqual(["BTC", "ETH"]);
  });

  it("maps assets to USDT pairs and skips stables", () => {
    expect(usdtPairsForAssets(["USDT", "USDC", "SOL", "btc"])).toEqual([
      "BTCUSDT",
      "SOLUSDT",
    ]);
  });

  it("unions tracked pairs with discovered earn assets", () => {
    const symbols = symbolsToTrack(["SOL", "MON"]);
    expect(symbols).toContain("BTCUSDT");
    expect(symbols).toContain("SOLUSDT");
    expect(symbols).toContain("MONUSDT");
    for (const t of TRACKED_SYMBOLS) {
      expect(symbols).toContain(t);
    }
  });

  it("flags assets whose USDT pair is not in known coverage", () => {
    const audit = auditPriceCoverage(
      ["USDT", "BTC", "SOL", "MON", "LUNC"],
      TRACKED_SYMBOLS,
    );
    expect(audit.stables).toEqual(["USDT"]);
    expect(audit.covered).toEqual(["BTC", "LUNC"]);
    expect(audit.missing).toEqual(["MON", "SOL"]);
    expect(audit.pairsMissing).toEqual(["MONUSDT", "SOLUSDT"]);
  });

  it("treats rate-map keys as coverage", () => {
    const audit = auditPriceCoverage(["SOL", "MON"], [
      ...TRACKED_SYMBOLS,
      "SOLUSDT",
    ]);
    expect(audit.covered).toEqual(["SOL"]);
    expect(audit.missing).toEqual(["MON"]);
  });
});
