import { describe, expect, it } from "vitest";
import {
  addDecimalStrings,
  formatBaseUnits,
  isZeroDecimal,
  scaleDownDecimal,
  sumDecimalStrings,
} from "../../web/src/lib/decimal-amount";
import { formatMon } from "../../web/src/lib/adapters/monad-stake";
import {
  microToHuman,
  normalizeLuncRewards,
} from "../../web/src/lib/adapters/lunc-stake";
import {
  earningsByCurrency,
  earningsOverTime,
  hasChartData,
} from "../../web/src/lib/earnings-charts";
import { formatDisplayAmount } from "../../web/src/lib/prices/convert";

const ADDR = "terra1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a";

describe("decimal-amount exact math", () => {
  it("preserves dust when scaling micro → human", () => {
    // Old Number()+toFixed(8) path rounded this to "0"
    expect(scaleDownDecimal("0.000000001", 6)).toBe("0.000000000000001");
    expect(microToHuman("0.000000001")).toBe("0.000000000000001");
  });

  it("preserves full Cosmos fractional micro precision", () => {
    expect(microToHuman("123.456789012345678")).toBe("0.000123456789012345678");
  });

  it("handles amounts beyond Number.MAX_SAFE_INTEGER", () => {
    const micro = "9007199254740993"; // MAX_SAFE_INTEGER + 1
    expect(Number(micro).toString()).not.toBe(micro); // float loses low bits
    expect(microToHuman(micro)).toBe("9007199254.740993");
  });

  it("sums many wei-scale rewards without float drift", () => {
    const oneWei = formatBaseUnits(1n, 18);
    expect(oneWei).toBe("0.000000000000000001");
    const parts = Array.from({ length: 1000 }, () => oneWei);
    expect(sumDecimalStrings(parts)).toBe("0.000000000000001");
    // Incremental Number() sum is wrong / unstable
    let floatSum = 0;
    for (const p of parts) floatSum += Number(p);
    expect(floatSum).not.toBe(1e-15);
  });

  it("addDecimalStrings is exact across scales", () => {
    expect(addDecimalStrings("0.1", "0.2")).toBe("0.3");
    expect(addDecimalStrings("1.000000000000000001", "2.000000000000000002")).toBe(
      "3.000000000000000003",
    );
  });

  it("isZeroDecimal covers padded zeros", () => {
    expect(isZeroDecimal("0")).toBe(true);
    expect(isZeroDecimal("0.000")).toBe(true);
    expect(isZeroDecimal("0.000001")).toBe(false);
  });
});

describe("LUNC dust rewards", () => {
  it("emits sub-uluna fractional pending rewards", () => {
    const events = normalizeLuncRewards(ADDR, {
      rewards: [
        {
          validator_address: "terravaloper1abc",
          reward: [{ denom: "uluna", amount: "0.5" }],
        },
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.amount).toBe("0.0000005");
  });

  it("keeps tiny fractional micros that toFixed(8) used to drop", () => {
    const events = normalizeLuncRewards(ADDR, {
      rewards: [
        {
          validator_address: "terravaloper1abc",
          reward: [{ denom: "uluna", amount: "0.000000001" }],
        },
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.amount).toBe("0.000000000000001");
    expect(Number(events[0]!.amount)).toBeGreaterThan(0);
  });
});

describe("Monad dust rewards", () => {
  it("formats 1 wei unclaimed reward exactly", () => {
    expect(formatMon(1n)).toBe("0.000000000000000001");
    expect(formatMon(2_500_000_000_000_000_000n)).toBe("2.5");
  });
});

describe("chart native accumulation of dust", () => {
  it("accumulates many tiny native rewards exactly before chart Number()", () => {
    const dust = "0.000000000000000001";
    const events = Array.from({ length: 1000 }, (_, i) => ({
      asset: "MON",
      amount: dust,
      earnedAt: `2024-01-01T00:00:${String(i % 60).padStart(2, "0")}.000Z`,
    }));
    const points = earningsOverTime(events);
    expect(points).toHaveLength(1);
    expect(points[0]!.period).toBe(1e-15);
    expect(points[0]!.cumulative).toBe(1e-15);

    const slices = earningsByCurrency(events);
    expect(slices).toEqual([{ asset: "MON", total: 1e-15, share: 1 }]);
    expect(hasChartData(events)).toBe(true);
  });
});

describe("display formatting of dust", () => {
  it("does not collapse sub-cent USD totals to $0.00", () => {
    expect(formatDisplayAmount(0.00012, "USD")).toMatch(/\$/);
    expect(formatDisplayAmount(0.00012, "USD")).not.toBe("$0.00");
  });
});
