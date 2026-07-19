import { describe, expect, it } from "vitest";
import {
  compareNumbers,
  compareStrings,
  sortAriaSort,
  sortAssetRows,
  toggleSortOrder,
} from "../../web/src/lib/table-sort";

describe("table-sort", () => {
  it("toggleSortOrder flips when same key, else uses default", () => {
    expect(toggleSortOrder("amount", "amount", "desc")).toBe("asc");
    expect(toggleSortOrder("amount", "amount", "asc")).toBe("desc");
    expect(toggleSortOrder("amount", "asset", "desc", "asc")).toBe("asc");
  });

  it("sortAssetRows by native amount desc then asset", () => {
    const rows = sortAssetRows(
      [
        { asset: "BTC", source: "binance", eventCount: 2, totalAmount: "0.1" },
        { asset: "ETH", source: "okx", eventCount: 5, totalAmount: "2" },
        { asset: "AAA", source: "binance", eventCount: 1, totalAmount: "2" },
      ],
      "native",
      "desc",
    );
    expect(rows.map((r) => r.asset)).toEqual(["AAA", "ETH", "BTC"]);
  });

  it("sortAssetRows pushes missing fiat to the end", () => {
    const rows = sortAssetRows(
      [
        {
          asset: "A",
          source: "binance",
          eventCount: 1,
          totalAmount: "1",
          fiatTotal: null,
        },
        {
          asset: "B",
          source: "binance",
          eventCount: 1,
          totalAmount: "1",
          fiatTotal: 10,
        },
        {
          asset: "C",
          source: "binance",
          eventCount: 1,
          totalAmount: "1",
          fiatTotal: 5,
        },
      ],
      "fiat",
      "desc",
    );
    expect(rows.map((r) => r.asset)).toEqual(["B", "C", "A"]);
  });

  it("compare helpers and aria-sort", () => {
    expect(compareStrings("a", "b", "asc")).toBeLessThan(0);
    expect(compareStrings("a", "b", "desc")).toBeGreaterThan(0);
    expect(compareNumbers(1, 2, "asc")).toBeLessThan(0);
    expect(sortAriaSort("asset", "asset", "asc")).toBe("ascending");
    expect(sortAriaSort("asset", "source", "desc")).toBe("none");
  });
});
