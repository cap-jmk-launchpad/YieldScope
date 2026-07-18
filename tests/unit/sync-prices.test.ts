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
    vi.useRealTimers();
    upsertOhlcvCandles.mockResolvedValue(2);
    // Default: pretend history exists so backfill=false paths stay incremental
    // and do not walk multi-page ranges with the default 80ms sleep.
    loadMaxOpenTime.mockResolvedValue("2026-07-18T08:00:00.000Z");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("incremental mode fetches recent candles when history exists", async () => {
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
      sleepMs: 0,
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
      sleepMs: 0,
    });

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]!.error).toMatch(/HTTP 400|Invalid symbol/i);
  });

  it("rethrows non-soft fetch errors and records persist failures", async () => {
    const { syncPrices } = await import("../../web/src/lib/prices/sync-prices");
    const { PricePersistError } = await import(
      "../../web/src/lib/prices/price-db"
    );

    const hard = await syncPrices({
      symbols: ["BTCUSDT"],
      fetchImpl: (async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch,
      backfill: false,
      sleepMs: 0,
    });
    expect(hard.errors.some((e) => /network down/.test(e.error))).toBe(true);

    loadMaxOpenTime.mockResolvedValue(null);
    upsertOhlcvCandles.mockRejectedValueOnce(new PricePersistError("db down"));
    const persistFail = await syncPrices({
      symbols: ["BTCUSDT"],
      fetchImpl: (async () => ({
        ok: true,
        json: async () => [
          [Date.now(), "1", "1", "1", "1", "0", Date.now()],
        ],
        text: async () => "",
      })) as unknown as typeof fetch,
      backfill: true,
      minuteLookbackDays: 1,
      dailyLookbackDays: 1,
      sleepMs: 0,
    });
    expect(persistFail.errors.some((e) => /db down/.test(e.error))).toBe(true);

    upsertOhlcvCandles.mockRejectedValueOnce("string-fail");
    const stringFail = await syncPrices({
      symbols: ["ETHUSDT"],
      fetchImpl: (async () => ({
        ok: true,
        json: async () => [
          [Date.now(), "1", "1", "1", "1", "0", Date.now()],
        ],
        text: async () => "",
      })) as unknown as typeof fetch,
      backfill: true,
      minuteLookbackDays: 1,
      dailyLookbackDays: 1,
      sleepMs: 0,
    });
    expect(stringFail.errors.some((e) => e.error === "string-fail")).toBe(true);
  });

  it("defaults symbols to TRACKED_SYMBOLS when omitted", async () => {
    loadMaxOpenTime.mockResolvedValue(null);
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => [],
      text: async () => "",
    }));
    const { syncPrices } = await import("../../web/src/lib/prices/sync-prices");
    const result = await syncPrices({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      backfill: true,
      minuteLookbackDays: 1,
      dailyLookbackDays: 1,
      sleepMs: 0,
    });
    expect(result.symbols).toEqual(
      expect.arrayContaining(["BTCUSDT", "ETHUSDT"]),
    );
  });
});
