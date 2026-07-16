import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BinanceAdapterError,
  normalizeBinanceRewards,
} from "../../web/src/lib/adapters/binance";

const root = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/binance");

function load(name: string) {
  return JSON.parse(readFileSync(join(root, name), "utf8"));
}

describe("Binance Simple Earn adapter", () => {
  it("normalizes reward rows from fixture", () => {
    const events = normalizeBinanceRewards(load("rewards-page1.json"));
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      source: "binance",
      asset: "USDT",
      amount: "1.23456789",
    });
    expect(events[0].earnedAt).toBe("2024-07-01T00:00:00.000Z");
    expect(events[1].asset).toBe("BTC");
    expect(events.every((e) => e.id.startsWith("binance:"))).toBe(true);
  });

  it("returns empty array for empty account", () => {
    expect(normalizeBinanceRewards(load("rewards-empty.json"))).toEqual([]);
  });

  it("fails closed on malformed row", () => {
    expect(() =>
      normalizeBinanceRewards({
        rows: [{ asset: "USDT", rewards: "1", time: undefined as unknown as number }],
      }),
    ).toThrow(BinanceAdapterError);
  });
});
