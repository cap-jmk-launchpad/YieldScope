import { describe, expect, it, vi } from "vitest";
import {
  INTERVAL_MS,
  fetchKlines,
  fetchKlinesRange,
  parseKlines,
} from "../../web/src/lib/prices/binance-klines";

const sampleRow = [
  Date.parse("2026-01-01T00:00:00.000Z"),
  "1",
  "2",
  "0.5",
  "1.5",
  "10",
  Date.parse("2026-01-01T00:00:59.999Z"),
] as const;

describe("binance-klines", () => {
  it("parseKlines maps rows", () => {
    const candles = parseKlines("BTCUSDT", "1m", [sampleRow as unknown as never]);
    expect(candles).toEqual([
      {
        symbol: "BTCUSDT",
        interval: "1m",
        openTime: "2026-01-01T00:00:00.000Z",
        open: "1",
        high: "2",
        low: "0.5",
        close: "1.5",
        volume: "10",
        source: "binance",
      },
    ]);
    expect(INTERVAL_MS["1m"]).toBe(60_000);
  });

  it("fetchKlines sets start/end and parses array", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => [sampleRow],
      text: async () => "",
    }));
    const candles = await fetchKlines({
      symbol: "BTCUSDT",
      interval: "1m",
      startMs: 1,
      endMs: 2,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(candles).toHaveLength(1);
    expect(String(fetchImpl.mock.calls[0]![0])).toMatch(/startTime=1/);
    expect(String(fetchImpl.mock.calls[0]![0])).toMatch(/endTime=2/);
  });

  it("fetchKlines throws on HTTP error and non-array payload", async () => {
    await expect(
      fetchKlines({
        symbol: "BTCUSDT",
        interval: "1d",
        fetchImpl: (async () => ({
          ok: false,
          status: 418,
          text: async () => "teapot",
        })) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/HTTP 418/);

    await expect(
      fetchKlines({
        symbol: "ETHUSDT",
        interval: "1m",
        fetchImpl: (async () => ({
          ok: true,
          json: async () => ({ not: "array" }),
          text: async () => "",
        })) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/unexpected payload/);
  });

  it("fetchKlinesRange paginates then stops on short page", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n += 1;
      const open = Date.parse("2026-01-01T00:00:00.000Z") + (n - 1) * 60_000;
      return {
        ok: true,
        json: async () => [
          [open, "1", "1", "1", "1", "0", open + 59_999],
        ],
        text: async () => "",
      };
    });
    const candles = await fetchKlinesRange({
      symbol: "BTCUSDT",
      interval: "1m",
      startMs: Date.parse("2026-01-01T00:00:00.000Z"),
      endMs: Date.parse("2026-01-01T00:02:00.000Z"),
      sleepMs: 0,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(candles.length).toBeGreaterThanOrEqual(1);
    expect(fetchImpl).toHaveBeenCalled();
  });

  it("fetchKlinesRange stops on empty page", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => [],
      text: async () => "",
    }));
    const candles = await fetchKlinesRange({
      symbol: "BTCUSDT",
      interval: "1m",
      startMs: 0,
      endMs: 60_000,
      sleepMs: 0,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(candles).toEqual([]);
  });
});
