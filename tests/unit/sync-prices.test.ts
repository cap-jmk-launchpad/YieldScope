import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadMaxOpenTime = vi.fn();
const upsertOhlcvCandles = vi.fn();

vi.mock("../../web/src/lib/prices/price-db", () => ({
  loadMaxOpenTime: (...args: unknown[]) => loadMaxOpenTime(...args),
  upsertOhlcvCandles: (...args: unknown[]) => upsertOhlcvCandles(...args),
  PricePersistError: class PricePersistError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "PricePersistError";
    }
  },
}));

describe("syncPrices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upsertOhlcvCandles.mockResolvedValue(2);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("incremental mode fetches recent candles when history exists", async () => {
    loadMaxOpenTime.mockResolvedValue("2026-07-18T08:00:00.000Z");

    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => [
        [
          Date.parse("2026-07-18T08:00:00.000Z"),
          "1",
          "1",
          "1",
          "1.5",
          "0",
          Date.parse("2026-07-18T08:00:59.999Z"),
        ],
      ],
      text: async () => "",
    }));

    const { syncPrices } = await import("../../web/src/lib/prices/sync-prices");
    const result = await syncPrices({
      symbols: ["BTCUSDT"],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      backfill: false,
    });

    expect(result.written).toBeGreaterThan(0);
    expect(result.mode).toBe("incremental");
    expect(upsertOhlcvCandles).toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalled();
  });

  it("records soft error for invalid Binance symbol", async () => {
    loadMaxOpenTime.mockResolvedValue(null);

    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ msg: "Invalid symbol." }),
      json: async () => ({}),
    }));

    const { syncPrices } = await import("../../web/src/lib/prices/sync-prices");
    const result = await syncPrices({
      symbols: ["NOTAREALUSDT"],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      backfill: true,
      minuteLookbackDays: 1,
      dailyLookbackDays: 1,
    });

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]!.error).toMatch(/HTTP 400|Invalid symbol/i);
  });
});
