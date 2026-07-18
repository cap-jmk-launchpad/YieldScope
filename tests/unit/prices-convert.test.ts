import { describe, expect, it, vi } from "vitest";
import {
  DISPLAY_CURRENCY_STORAGE_KEY,
  convertAmount,
  formatDisplayAmount,
  fromUsdt,
  loadDisplayCurrencyFromStorage,
  parseDisplayCurrency,
  saveDisplayCurrencyToStorage,
  sumInDisplayCurrency,
  toUsdt,
} from "../../web/src/lib/prices/convert";
import { parseKlines, fetchKlinesRange } from "../../web/src/lib/prices/binance-klines";

const RATES = {
  BTCUSDT: 100_000,
  ETHUSDT: 4_000,
  EURUSDT: 1.1,
  LUNCUSDT: 0.0001,
};

describe("display currency conversion", () => {
  it("treats USDT as 1:1 USD", () => {
    expect(toUsdt(12.5, "USDT", RATES)).toBe(12.5);
    expect(convertAmount(12.5, "USDT", "USD", RATES)).toBe(12.5);
    expect(convertAmount(11, "USDT", "EUR", RATES)).toBeCloseTo(10, 8);
  });

  it("converts BTC/ETH via USDT pairs", () => {
    expect(convertAmount(0.01, "BTC", "USD", RATES)).toBe(1000);
    expect(convertAmount(0.01, "BTC", "EUR", RATES)).toBeCloseTo(1000 / 1.1, 6);
    expect(convertAmount(2, "ETH", "BTC", RATES)).toBeCloseTo(8000 / 100_000, 8);
  });

  it("returns null when rate missing", () => {
    expect(convertAmount(1, "MON", "USD", RATES)).toBeNull();
    expect(fromUsdt(10, "EUR", {})).toBeNull();
  });

  it("sums by-asset aggregates and reports skips", () => {
    const sum = sumInDisplayCurrency(
      [
        { asset: "USDT", totalAmount: "100" },
        { asset: "BTC", totalAmount: "0.01" },
        { asset: "MON", totalAmount: "50" },
      ],
      "USD",
      RATES,
    );
    expect(sum.total).toBe(1100);
    expect(sum.convertedCount).toBe(2);
    expect(sum.skippedAssets).toEqual(["MON"]);
  });

  it("formats fiat and crypto display amounts", () => {
    expect(formatDisplayAmount(12.345, "USD")).toMatch(/\$12\.35/);
    expect(formatDisplayAmount(12.345, "EUR")).toMatch(/€12\.35/);
    expect(formatDisplayAmount(0.01234567, "BTC")).toContain("BTC");
    expect(formatDisplayAmount(null, "USD")).toBe("—");
    expect(formatDisplayAmount(0.00012, "USD")).not.toBe("$0.00");
  });

  it("persists preference in storage", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    };
    expect(loadDisplayCurrencyFromStorage(storage)).toBe("USD");
    saveDisplayCurrencyToStorage("EUR", storage);
    expect(store.get(DISPLAY_CURRENCY_STORAGE_KEY)).toBe("EUR");
    expect(loadDisplayCurrencyFromStorage(storage)).toBe("EUR");
    expect(parseDisplayCurrency("btc")).toBe("BTC");
    expect(parseDisplayCurrency("nope")).toBe("USD");
  });
});

describe("binance klines parse + range", () => {
  it("parseKlines maps Binance rows", () => {
    const candles = parseKlines("BTCUSDT", "1m", [
      [
        1_700_000_000_000,
        "100",
        "110",
        "90",
        "105",
        "12.5",
        1_700_000_059_999,
      ],
    ]);
    expect(candles).toHaveLength(1);
    expect(candles[0]!.close).toBe("105");
    expect(candles[0]!.symbol).toBe("BTCUSDT");
    expect(candles[0]!.openTime).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it("fetchKlinesRange paginates until short page", async () => {
    const pages: unknown[][] = [
      Array.from({ length: 1000 }, (_, i) => [
        1_000 + i * 60_000,
        "1",
        "1",
        "1",
        "1",
        "0",
        1_000 + i * 60_000 + 59_999,
      ]),
      [
        [
          1_000 + 1000 * 60_000,
          "2",
          "2",
          "2",
          "2",
          "0",
          1_000 + 1000 * 60_000 + 59_999,
        ],
      ],
    ];
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      const body = pages[calls++] ?? [];
      return {
        ok: true,
        json: async () => body,
        text: async () => "",
      } as Response;
    });

    const candles = await fetchKlinesRange({
      symbol: "BTCUSDT",
      interval: "1m",
      startMs: 1_000,
      endMs: 1_000 + 2000 * 60_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepMs: 0,
    });
    expect(calls).toBe(2);
    expect(candles).toHaveLength(1001);
    expect(candles[candles.length - 1]!.close).toBe("2");
  });
});
