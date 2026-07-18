import { describe, expect, it } from "vitest";
import {
  chartDisplayUnit,
  earningsByCurrency,
  earningsByYear,
  earningsOverTime,
  hasChartData,
  type ChartEarnEvent,
} from "../../web/src/lib/earnings-charts";

const ev = (
  partial: Partial<ChartEarnEvent> & Pick<ChartEarnEvent, "amount" | "earnedAt">,
): ChartEarnEvent => ({
  asset: partial.asset ?? "USDT",
  amount: partial.amount,
  earnedAt: partial.earnedAt,
});

describe("earningsOverTime", () => {
  it("returns empty for no events", () => {
    expect(earningsOverTime([])).toEqual([]);
  });

  it("buckets by UTC day with period and cumulative", () => {
    const points = earningsOverTime([
      ev({ amount: "1", earnedAt: "2024-01-01T10:00:00.000Z" }),
      ev({ amount: "2", earnedAt: "2024-01-01T22:00:00.000Z" }),
      ev({ amount: "3", earnedAt: "2024-01-03T00:00:00.000Z" }),
    ]);
    expect(points).toEqual([
      { date: "2024-01-01", period: 3, cumulative: 3 },
      { date: "2024-01-03", period: 3, cumulative: 6 },
    ]);
  });

  it("applies convertAmount across assets", () => {
    const points = earningsOverTime(
      [
        ev({ asset: "BTC", amount: "1", earnedAt: "2024-06-01T00:00:00.000Z" }),
        ev({ asset: "USDT", amount: "100", earnedAt: "2024-06-02T00:00:00.000Z" }),
      ],
      {
        displayCurrency: "USD",
        convertAmount: (asset, amount) =>
          asset === "BTC" ? Number(amount) * 50_000 : Number(amount),
      },
    );
    expect(chartDisplayUnit({ displayCurrency: "USD" })).toBe("USD");
    expect(points).toEqual([
      { date: "2024-06-01", period: 50_000, cumulative: 50_000 },
      { date: "2024-06-02", period: 100, cumulative: 50_100 },
    ]);
  });

  it("skips invalid dates and non-finite amounts", () => {
    expect(
      earningsOverTime([
        ev({ amount: "1", earnedAt: "not-a-date" }),
        ev({ amount: "NaN", earnedAt: "2024-01-01T00:00:00.000Z" }),
        ev({ amount: "5", earnedAt: "2024-01-02T00:00:00.000Z" }),
      ]),
    ).toEqual([{ date: "2024-01-02", period: 5, cumulative: 5 }]);
  });
});

describe("earningsByYear", () => {
  it("sums per UTC calendar year", () => {
    expect(
      earningsByYear([
        ev({ amount: "10", earnedAt: "2023-12-31T23:00:00.000Z" }),
        ev({ amount: "1", earnedAt: "2024-01-01T00:00:00.000Z" }),
        ev({ amount: "2", earnedAt: "2024-07-01T00:00:00.000Z" }),
        ev({ amount: "4", earnedAt: "2025-01-15T00:00:00.000Z" }),
      ]),
    ).toEqual([
      { year: 2023, total: 10 },
      { year: 2024, total: 3 },
      { year: 2025, total: 4 },
    ]);
  });

  it("uses convertAmount hook", () => {
    expect(
      earningsByYear(
        [ev({ asset: "ETH", amount: "2", earnedAt: "2024-05-01T00:00:00.000Z" })],
        { convertAmount: () => 3_000 },
      ),
    ).toEqual([{ year: 2024, total: 3_000 }]);
  });

  it("convertAmount skips invalid years and non-finite values", () => {
    expect(
      earningsByYear(
        [
          ev({ amount: "1", earnedAt: "bad" }),
          ev({ amount: "2", earnedAt: "2024-01-01T00:00:00.000Z" }),
          ev({ amount: "3", earnedAt: "2023-01-01T00:00:00.000Z" }),
        ],
        {
          convertAmount: (_a, amount) =>
            amount === "2" ? Number.NaN : Number(amount),
        },
      ),
    ).toEqual([{ year: 2023, total: 3 }]);
  });
});

describe("earningsByCurrency", () => {
  it("groups by asset with share of total", () => {
    const slices = earningsByCurrency([
      ev({ asset: "USDT", amount: "75", earnedAt: "2024-01-01T00:00:00.000Z" }),
      ev({ asset: "BTC", amount: "25", earnedAt: "2024-01-02T00:00:00.000Z" }),
      ev({ asset: "USDT", amount: "25", earnedAt: "2024-01-03T00:00:00.000Z" }),
    ]);
    expect(slices).toEqual([
      { asset: "USDT", total: 100, share: 0.8 },
      { asset: "BTC", total: 25, share: 0.2 },
    ]);
  });

  it("omits zero and non-finite amounts", () => {
    expect(
      earningsByCurrency([
        ev({ asset: "USDT", amount: "0", earnedAt: "2024-01-01T00:00:00.000Z" }),
        ev({ asset: "ETH", amount: "bad", earnedAt: "2024-01-01T00:00:00.000Z" }),
      ]),
    ).toEqual([]);
  });

  it("sorts by total descending then asset name", () => {
    expect(
      earningsByCurrency([
        ev({ asset: "B", amount: "1", earnedAt: "2024-01-01T00:00:00.000Z" }),
        ev({ asset: "A", amount: "1", earnedAt: "2024-01-01T00:00:00.000Z" }),
        ev({ asset: "C", amount: "5", earnedAt: "2024-01-01T00:00:00.000Z" }),
      ]).map((s) => s.asset),
    ).toEqual(["C", "A", "B"]);
  });

  it("convertAmount path groups assets and computes shares", () => {
    const slices = earningsByCurrency(
      [
        ev({ asset: "USDT", amount: "1", earnedAt: "2024-01-01T00:00:00.000Z" }),
        ev({ asset: "  ", amount: "1", earnedAt: "2024-01-01T00:00:00.000Z" }),
        ev({ asset: "BTC", amount: "0", earnedAt: "2024-01-01T00:00:00.000Z" }),
        ev({ asset: "ETH", amount: "2", earnedAt: "2024-01-01T00:00:00.000Z" }),
      ],
      {
        convertAmount: (asset, amount) => {
          if (asset === "BTC") return 0;
          if (asset === "UNKNOWN") return 25;
          return asset === "ETH" ? Number(amount) * 10 : Number(amount);
        },
      },
    );
    // UNKNOWN (blank asset) → 25, ETH → 20, USDT → 1
    expect(slices.map((s) => s.asset)).toEqual(["UNKNOWN", "ETH", "USDT"]);
    expect(slices[0].share).toBeCloseTo(25 / 46);
    expect(slices.find((s) => s.asset === "USDT")?.share).toBeCloseTo(1 / 46);
  });

  it("defaults display unit to native", () => {
    expect(chartDisplayUnit()).toBe("native");
    expect(chartDisplayUnit({ displayCurrency: "  " })).toBe("native");
  });
});

describe("hasChartData", () => {
  it("is false for empty or invalid-only ledgers", () => {
    expect(hasChartData([])).toBe(false);
    expect(
      hasChartData([ev({ amount: "0", earnedAt: "2024-01-01T00:00:00.000Z" })]),
    ).toBe(false);
  });

  it("is true when at least one finite non-zero earn exists", () => {
    expect(
      hasChartData([ev({ amount: "0.01", earnedAt: "2024-01-01T00:00:00.000Z" })]),
    ).toBe(true);
  });
});
