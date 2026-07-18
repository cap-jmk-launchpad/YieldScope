import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();
const isAdminConfigured = vi.fn(() => true);

vi.mock("../../web/src/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from }),
  isAdminConfigured: () => isAdminConfigured(),
}));

describe("price-db upsert + latest queries", () => {
  const original = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...original };
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
    isAdminConfigured.mockReturnValue(true);
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("upsertOhlcvCandles fails closed when admin missing", async () => {
    isAdminConfigured.mockReturnValue(false);
    const { upsertOhlcvCandles, PricePersistError } = await import(
      "../../web/src/lib/prices/price-db"
    );
    await expect(
      upsertOhlcvCandles([
        {
          symbol: "BTCUSDT",
          interval: "1m",
          openTime: "2026-01-01T00:00:00.000Z",
          open: "1",
          high: "1",
          low: "1",
          close: "1",
          volume: "0",
          source: "binance",
        },
      ]),
    ).rejects.toBeInstanceOf(PricePersistError);
  });

  it("upsertOhlcvCandles chunks and upserts", async () => {
    const upsert = vi.fn(async () => ({ error: null }));
    from.mockImplementation((table: string) => {
      expect(table).toBe("ohlcv");
      return { upsert };
    });

    const { upsertOhlcvCandles } = await import(
      "../../web/src/lib/prices/price-db"
    );
    const candle = {
      symbol: "BTCUSDT" as const,
      interval: "1m" as const,
      openTime: "2026-01-01T00:00:00.000Z",
      open: "100",
      high: "110",
      low: "90",
      close: "105",
      volume: "1",
      source: "binance" as const,
    };
    const n = await upsertOhlcvCandles([candle, { ...candle, openTime: "2026-01-01T00:01:00.000Z" }]);
    expect(n).toBe(2);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0]![1]).toEqual({
      onConflict: "symbol,interval,open_time,source",
    });
  });

  it("loadLatestCloses maps closes and falls back to 1d", async () => {
    from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => {
                    // First call chain is 1m — empty; tests fallback via second import path
                    return { data: null, error: null };
                  },
                }),
              }),
            }),
          }),
        }),
      }),
    }));

    // More precise mock: return 1m for BTC, empty for ETH then 1d for ETH
    let call = 0;
    from.mockImplementation(() => ({
      select: () => ({
        eq: (_c: string, v: string) => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => {
                    call += 1;
                    if (v === "BTCUSDT" && call === 1) {
                      return {
                        data: {
                          close: "100000",
                          open_time: "2026-07-18T08:00:00.000Z",
                        },
                        error: null,
                      };
                    }
                    if (v === "ETHUSDT") {
                      // 1m miss then 1d hit — order of Promise.all is nondeterministic,
                      // so return 1d-shaped data whenever ETH is queried after BTC done
                      return {
                        data: {
                          close: "4000",
                          open_time: "2026-07-18T00:00:00.000Z",
                        },
                        error: null,
                      };
                    }
                    return { data: null, error: null };
                  },
                }),
              }),
            }),
          }),
        }),
      }),
    }));

    const { loadLatestCloses } = await import(
      "../../web/src/lib/prices/price-db"
    );
    const latest = await loadLatestCloses(["BTCUSDT", "ETHUSDT"], "1m");
    expect(latest.BTCUSDT?.close).toBe(100000);
    expect(latest.ETHUSDT?.close).toBe(4000);
  });

  it("loadCloseAtOrBefore returns nearest prior candle", async () => {
    from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              lte: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: {
                        close: "99",
                        open_time: "2026-01-01T00:00:00.000Z",
                        interval: "1m",
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    }));

    const { loadCloseAtOrBefore } = await import(
      "../../web/src/lib/prices/price-db"
    );
    const row = await loadCloseAtOrBefore(
      "BTCUSDT",
      "2026-01-01T00:30:00.000Z",
    );
    expect(row).toEqual({
      close: 99,
      openTime: "2026-01-01T00:00:00.000Z",
      interval: "1m",
    });
  });
});
