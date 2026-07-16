import { describe, expect, it } from "vitest";
import {
  describeRoot,
  earnEventLeaf,
  merkleRoot,
  windowBounds,
} from "../../web/src/lib/merkle";
import type { EarnEvent } from "../../web/src/lib/adapters/types";

const sample: EarnEvent = {
  id: "binance:1",
  source: "binance",
  asset: "USDT",
  amount: "1.5",
  earnedAt: "2024-07-01T00:00:00.000Z",
};

describe("merkle", () => {
  it("returns zero hash for empty events", () => {
    expect(merkleRoot([])).toBe(`0x${"00".repeat(32)}`);
  });

  it("is deterministic for one and many leaves", () => {
    const a = merkleRoot([sample]);
    const b = merkleRoot([sample]);
    expect(a).toBe(b);
    expect(a.startsWith("0x")).toBe(true);
    const two = merkleRoot([
      sample,
      { ...sample, id: "binance:2", amount: "2" },
    ]);
    expect(two).not.toBe(a);
    const three = merkleRoot([
      sample,
      { ...sample, id: "binance:2", amount: "2" },
      { ...sample, id: "binance:3", amount: "3" },
    ]);
    expect(three).not.toBe(two);
  });

  it("earnEventLeaf hashes canonical fields", () => {
    const leaf = earnEventLeaf(sample);
    expect(leaf).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("windowBounds uses event times", () => {
    const bounds = windowBounds([
      sample,
      { ...sample, id: "x", earnedAt: "2024-07-02T00:00:00.000Z" },
    ]);
    expect(bounds.windowEnd).toBeGreaterThan(bounds.windowStart);
  });

  it("windowBounds empty uses now", () => {
    const before = Math.floor(Date.now() / 1000);
    const bounds = windowBounds([]);
    expect(bounds.windowStart).toBeGreaterThanOrEqual(before - 2);
    expect(bounds.windowEnd).toBe(bounds.windowStart);
  });

  it("describeRoot returns the root", () => {
    const root = merkleRoot([sample]);
    expect(describeRoot(root)).toBe(root);
  });
});
