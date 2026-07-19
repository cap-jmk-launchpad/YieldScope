/**
 * Focused gap-fillers to drive backend-ops coverage to 100%.
 * Prefer extending existing suites when mocks collide; keep this for cross-cutting edges.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultConvertAmount,
  earningsByYear,
  hasChartData,
} from "../../web/src/lib/earnings-charts";
import { getLedger, resetLedger } from "../../web/src/lib/ledger-store";
import {
  SyncRangeError,
  parseSyncRangeBody,
  resolveSyncRange,
} from "../../web/src/lib/sync-range";
import {
  assetToUsdtSymbol,
  convertAmount,
  formatDisplayAmount,
  fromUsdt,
  loadDisplayCurrencyFromStorage,
  saveDisplayCurrencyToStorage,
  sumInDisplayCurrency,
  toUsdt,
} from "../../web/src/lib/prices/convert";
import {
  fetchKlines,
  fetchKlinesRange,
} from "../../web/src/lib/prices/binance-klines";
import {
  decodeGetDelegationsResult,
  fetchMonadStakeEarnEvents,
} from "../../web/src/lib/adapters/monad-stake";
import {
  denomToAsset,
  microToHuman,
  normalizeLuncRewards,
  parseLuncAddress,
} from "../../web/src/lib/adapters/lunc-stake";
import {
  formatOkxApiError,
  okxEventId,
  normalizeOkxEarn,
} from "../../web/src/lib/adapters/okx";
import {
  binanceEventId,
  fetchBinanceEarnEvents,
  normalizeBinanceRewards,
} from "../../web/src/lib/adapters/binance";
import { establishRecoverySession } from "../../web/src/lib/auth/recovery-session";
import {
  maskWalletAddress,
  summarizeSavedSources,
} from "../../web/src/lib/credentials-db";
import type { Hex } from "viem";
import { encodeAbiParameters } from "viem";

describe("backend-ops coverage gaps", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("ledger-store initializes when global slot is empty", () => {
    delete (globalThis as { __yieldscopeLedger?: unknown }).__yieldscopeLedger;
    const snap = getLedger();
    expect(snap.events).toEqual([]);
    expect(snap.sources.binance.status).toBe("not_connected");
    resetLedger();
  });

  it("sync-range covers invalid date-only and flat non-string bounds", () => {
    expect(() =>
      resolveSyncRange({ mode: "custom", from: "2024-13-99", to: "2024-01-01" }),
    ).toThrow(SyncRangeError);
    expect(parseSyncRangeBody({ from: 1, to: 2, mode: "custom" })).toBeUndefined();
  });

  it("recovery session expired with only error_code", async () => {
    const client = {
      auth: {
        exchangeCodeForSession: vi.fn(),
        verifyOtp: vi.fn(),
        setSession: vi.fn(),
        getSession: vi.fn(),
      },
    };
    const result = await establishRecoverySession(
      client,
      "https://app.example/x?error_code=otp_expired",
    );
    expect(result).toEqual({
      ok: false,
      reason: "expired",
      detail: undefined,
    });
  });

  it("credentials helpers cover empty mask and summarize variants", () => {
    expect(maskWalletAddress("")).toBe("");
    expect(maskWalletAddress("short")).toBe("••••");
    expect(
      summarizeSavedSources({
        binance: { configured: false },
        okx: { configured: false },
        monad_stake: { configured: false },
        lunc_stake: { configured: false },
      }),
    ).toBe("Nothing saved yet.");
    expect(
      summarizeSavedSources({
        binance: { configured: true },
        okx: { configured: false },
        monad_stake: { configured: false },
        lunc_stake: { configured: false },
      }),
    ).toMatch(/Binance saved/);
    expect(
      summarizeSavedSources({
        binance: { configured: true },
        okx: { configured: true },
        monad_stake: { configured: true },
        lunc_stake: { configured: true },
      }),
    ).toMatch(/LUNC address/);
  });

  it("earnings charts defaultConvert and convert-year path", () => {
    expect(defaultConvertAmount("USDT", "1.5")).toBe(1.5);
    expect(defaultConvertAmount("USDT", "nope")).toBe(0);
    const points = earningsByYear(
      [
        {
          id: "1",
          source: "binance",
          asset: "USDT",
          amount: "2",
          earnedAt: "2024-07-01T00:00:00.000Z",
        },
        {
          id: "2",
          source: "binance",
          asset: "USDT",
          amount: "3",
          earnedAt: "2025-01-01T00:00:00.000Z",
        },
        {
          id: "bad",
          source: "binance",
          asset: "USDT",
          amount: "1",
          earnedAt: "not-a-date",
        },
      ],
      { convertAmount: (asset, amount) => (asset === "USDT" ? Number(amount) : NaN) },
    );
    expect(points).toEqual([
      { year: 2024, total: 2 },
      { year: 2025, total: 3 },
    ]);
    expect(
      hasChartData([
        {
          id: "z",
          source: "binance",
          asset: "USDT",
          amount: "0",
          earnedAt: "2024-01-01T00:00:00.000Z",
        },
      ]),
    ).toBe(false);
  });

  it("prices convert covers EUR, storage errors, and skip paths", () => {
    expect(assetToUsdtSymbol("EUR")).toBe("EURUSDT");
    expect(loadDisplayCurrencyFromStorage(null)).toBe("USD");
    expect(
      loadDisplayCurrencyFromStorage({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBe("USD");
    saveDisplayCurrencyToStorage("EUR", null);
    saveDisplayCurrencyToStorage("EUR", {
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(toUsdt(Number.NaN, "BTC", {})).toBeNull();
    expect(toUsdt(1, "USDT", {})).toBe(1);
    expect(toUsdt(1, "BTC", {})).toBeNull();
    expect(fromUsdt(Number.NaN, "USD", {})).toBeNull();
    expect(fromUsdt(100, "ETH", { ETHUSDT: 2000 })).toBeCloseTo(0.05);
    expect(
      sumInDisplayCurrency(
        [
          { asset: "BTC", totalAmount: "Infinity" },
          { asset: "USDT", totalAmount: 10 },
        ],
        "USD",
        {},
      ).skippedAssets,
    ).toContain("BTC");
    expect(
      sumInDisplayCurrency(
        [{ asset: "ETH", totalAmount: Number.NaN }],
        "USD",
        { ETHUSDT: 1 },
      ).skippedAssets,
    ).toContain("ETH");
    expect(
      sumInDisplayCurrency([], "USD", {}).total,
    ).toBeNull();
    expect(formatDisplayAmount(null, "USD")).toBe("—");
    expect(convertAmount(1, "BTC", "USD", {})).toBeNull();
  });

  it("binance-klines covers default fetch, text catch, stuck cursor, sleep", async () => {
    const prevFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => {
        throw new Error("no body");
      },
    })) as unknown as typeof fetch;
    await expect(
      fetchKlines({ symbol: "BTCUSDT", interval: "1m" }),
    ).rejects.toThrow(/HTTP 500/);
    globalThis.fetch = prevFetch;

    const stuck = vi.fn(async () => ({
      ok: true,
      json: async () => [
        [
          500, // open time behind cursor → next <= cursor
          "1",
          "1",
          "1",
          "1",
          "0",
          999,
        ],
      ],
      text: async () => "",
    }));
    const page = await fetchKlinesRange({
      symbol: "BTCUSDT",
      interval: "1m",
      startMs: 1_000,
      endMs: 10_000,
      sleepMs: 0,
      fetchImpl: stuck as unknown as typeof fetch,
    });
    expect(page.length).toBe(1);

    // Full page triggers sleep path
    const fullPage = Array.from({ length: 1000 }, (_, i) => [
      1_000 + i,
      "1",
      "1",
      "1",
      "1",
      "0",
      1_000 + i + 1,
    ]);
    let n = 0;
    const sleepy = vi.fn(async () => {
      n += 1;
      return {
        ok: true,
        json: async () => (n === 1 ? fullPage : []),
        text: async () => "",
      };
    });
    await fetchKlinesRange({
      symbol: "BTCUSDT",
      interval: "1m",
      startMs: 1_000,
      endMs: 1_000 + 2_000,
      sleepMs: 1,
      fetchImpl: sleepy as unknown as typeof fetch,
    });
    expect(sleepy).toHaveBeenCalled();

    const withEndDefault = await fetchKlinesRange({
      symbol: "BTCUSDT",
      interval: "1m",
      startMs: Date.now() + 60_000,
      sleepMs: 0,
      fetchImpl: (async () => ({
        ok: true,
        json: async () => [],
        text: async () => "",
      })) as unknown as typeof fetch,
    });
    expect(withEndDefault).toEqual([]);
  });

  it("monad multi-page delegations and empty decode", async () => {
    expect(() => decodeGetDelegationsResult("0x" as Hex)).toThrow(
      /Empty getDelegations/,
    );

    // Official order: (bool isDone, uint64 nextValId, uint64[] valIds)
    const page1 = encodeAbiParameters(
      [{ type: "bool" }, { type: "uint64" }, { type: "uint64[]" }],
      [false, 2n, [1n]],
    );
    const page2 = encodeAbiParameters(
      [{ type: "bool" }, { type: "uint64" }, { type: "uint64[]" }],
      [true, 0n, [2n]],
    );
    const delegatorData = encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint64" },
        { type: "uint64" },
      ],
      [1n, 0n, 1n, 0n, 0n, 0n, 0n],
    );

    let listCalls = 0;
    const events = await fetchMonadStakeEarnEvents(
      "0x0000000000000000000000000000000000000001",
      async () => {
        if (listCalls < 2) {
          const page = listCalls === 0 ? page1 : page2;
          listCalls += 1;
          return page;
        }
        return delegatorData;
      },
    );
    expect(listCalls).toBe(2);
    expect(events.length).toBe(2);
  });

  it("lunc parse/normalize edge paths", () => {
    expect(
      parseLuncAddress(
        "https://finder.terra.money/classic/address/terra1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a?addr=terra1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a",
      ),
    ).toMatch(/^terra1/);
    // query addr param
    expect(
      parseLuncAddress(
        "https://example.com/wallet?addr=terra1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a",
      ),
    ).toMatch(/^terra1/);
    // free text with slash so URL parse fails → embedded match
    expect(
      parseLuncAddress("see /terra1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a"),
    ).toMatch(/^terra1/);
    expect(denomToAsset("uusd")).toBe("USTC");
    expect(denomToAsset("ufoo")).toBe("FOO");
    expect(denomToAsset("ibc/XYZ")).toBe("IBC/XYZ");
    expect(() => microToHuman("not-a-number")).toThrow(/Malformed reward amount/);
    expect(() =>
      normalizeLuncRewards("terra1abc", null as unknown as never),
    ).toThrow(/Malformed LCD/);
    expect(() =>
      normalizeLuncRewards("terra1abc", {
        rewards: [
          {
            validator_address: "val1",
            reward: [{ denom: "uluna", amount: "1.2.3" }],
          },
        ],
      }),
    ).toThrow(/Bad amount/);
    // rewards missing → []
    expect(
      normalizeLuncRewards("terra1abc", {} as never, new Date("2024-01-01")),
    ).toEqual([]);
    // total-only with zero micro skipped
    expect(
      normalizeLuncRewards(
        "terra1abc",
        { rewards: [], total: [{ denom: "uluna", amount: "0" }] },
        new Date("2024-01-01"),
      ),
    ).toEqual([]);
  });

  it("okx formatOkxApiError branches and missing product id", () => {
    expect(formatOkxApiError("50113", "bad")).toMatch(/secret\/passphrase/);
    expect(formatOkxApiError("50101")).toMatch(/environment mismatch/);
    expect(formatOkxApiError("99999")).toMatch(/OKX error code 99999/);
    expect(okxEventId({ ccy: "USDT", amt: "1", ts: "1" })).toContain("earn");
    expect(
      normalizeOkxEarn({ code: "0", data: undefined }).length,
    ).toBe(0);
  });

  it("sync-range cexCoverageRefreshHint long and short spans", async () => {
    const { cexCoverageRefreshHint } = await import(
      "../../web/src/lib/sync-range"
    );
    const short = Array.from({ length: 50 }, (_, i) => ({
      source: "binance" as const,
      earnedAt: new Date(Date.parse("2024-07-01T00:00:00.000Z") + i * 60_000).toISOString(),
    }));
    expect(cexCoverageRefreshHint(short)).toMatch(/Re-download full history/);

    const long = Array.from({ length: 50 }, (_, i) => ({
      source: "okx" as const,
      earnedAt: new Date(
        Date.parse("2024-01-01T00:00:00.000Z") + i * 86_400_000,
      ).toISOString(),
    }));
    expect(cexCoverageRefreshHint(long)).toBeNull();
  });

  it("binance readBody catch, multi-page cap, and range defaults", async () => {
    expect(binanceEventId({ asset: "USDT", rewards: "1", time: 1 })).toContain(
      "reward",
    );
    expect(normalizeBinanceRewards({}).length).toBe(0);

    const rowsForPage = (pageNum: number) =>
      Array.from({ length: 100 }, (_, i) => ({
        asset: "USDT",
        rewards: String(i),
        time: 1_719_792_000_000 + pageNum * 1000 + i,
        projectId: `p${pageNum}-${i}`,
      }));
    let page = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        page += 1;
        return {
          ok: true,
          json: async () => ({ rows: rowsForPage(page), total: 10_000 }),
          text: async () => {
            throw new Error("boom");
          },
        };
      }),
    );
    const events = await fetchBinanceEarnEvents(
      { apiKey: "k", apiSecret: "s" },
      {
        startMs: Date.parse("2024-07-01T00:00:00.000Z"),
        endMs: Date.parse("2024-07-02T00:00:00.000Z"),
      },
    );
    expect(events.length).toBeGreaterThan(100);
    expect(page).toBe(50);

    // only endMs → startMs defaults to lookback
    page = 0;
    await fetchBinanceEarnEvents(
      { apiKey: "k", apiSecret: "s" },
      { endMs: Date.parse("2024-07-02T00:00:00.000Z") },
    );
    expect(page).toBeGreaterThan(0);

    // only startMs → endMs defaults to now
    page = 0;
    await fetchBinanceEarnEvents(
      { apiKey: "k", apiSecret: "s" },
      { startMs: Date.now() - 60_000 },
    );
    expect(page).toBeGreaterThan(0);

    // HTTP error with text() throwing
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 403,
        text: async () => {
          throw new Error("nope");
        },
      })),
    );
    await expect(
      fetchBinanceEarnEvents({ apiKey: "k", apiSecret: "s" }),
    ).rejects.toThrow(/HTTP 403/);
  });
});
