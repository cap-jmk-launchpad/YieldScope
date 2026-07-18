/**
 * API-level e2e: custom sync from 2022-01-01 through mocked adapters.
 * Proves FE range → plan → chunked CEX fetch → LUNC pending-only → ledger.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSyncRangeFromUi,
  chunkTimeRange,
  parseSyncRangeBody,
  resolveSyncRange,
  syncRangesForSource,
} from "../../web/src/lib/sync-range";
import {
  getLedger,
  replaceSourceEvents,
  resetLedger,
} from "../../web/src/lib/ledger-store";
import type { EarnEvent } from "../../web/src/lib/adapters/types";

const persistSourceSync = vi.fn();
const getSourceHighWaterMs = vi.fn();
const fetchBinanceEarnEvents = vi.fn();
const fetchOkxEarnEvents = vi.fn();
const fetchLuncStakeEarnEvents = vi.fn();

vi.mock("../../web/src/lib/ledger-db", () => {
  class LedgerPersistError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "LedgerPersistError";
    }
  }
  return {
    LedgerPersistError,
    persistSourceSync: (...args: unknown[]) => persistSourceSync(...args),
    getSourceHighWaterMs: (...args: unknown[]) => getSourceHighWaterMs(...args),
    loadDbLedger: vi.fn(async () => getLedger()),
  };
});

vi.mock("../../web/src/lib/adapters/binance", async () => {
  const actual = await vi.importActual<
    typeof import("../../web/src/lib/adapters/binance")
  >("../../web/src/lib/adapters/binance");
  return {
    ...actual,
    fetchBinanceEarnEvents: (...args: unknown[]) =>
      fetchBinanceEarnEvents(...args),
  };
});

vi.mock("../../web/src/lib/adapters/okx", async () => {
  const actual = await vi.importActual<
    typeof import("../../web/src/lib/adapters/okx")
  >("../../web/src/lib/adapters/okx");
  return {
    ...actual,
    fetchOkxEarnEvents: (...args: unknown[]) => fetchOkxEarnEvents(...args),
  };
});

vi.mock("../../web/src/lib/adapters/lunc-stake", async () => {
  const actual = await vi.importActual<
    typeof import("../../web/src/lib/adapters/lunc-stake")
  >("../../web/src/lib/adapters/lunc-stake");
  return {
    ...actual,
    fetchLuncStakeEarnEvents: (...args: unknown[]) =>
      fetchLuncStakeEarnEvents(...args),
  };
});

function ev(
  partial: Partial<EarnEvent> &
    Pick<EarnEvent, "id" | "source" | "earnedAt" | "amount">,
): EarnEvent {
  return { asset: partial.asset ?? "USDT", ...partial };
}

describe("e2e: custom sync 2022-01-01 → now (mocked adapters)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.USE_FIXTURE_DEMO = "0";
    persistSourceSync.mockResolvedValue({ profileId: "p1", eventCount: 1 });
    getSourceHighWaterMs.mockResolvedValue(null);
    resetLedger();
  });

  afterEach(() => {
    delete process.env.USE_FIXTURE_DEMO;
  });

  it("accepts 2022-01-01 custom range and splits CEX transport windows", () => {
    const range = buildSyncRangeFromUi("custom", "2022-01-01", "2026-07-18");
    expect(parseSyncRangeBody({ source: "all", range })).toEqual({
      mode: "custom",
      from: "2022-01-01",
      to: "2026-07-18",
    });
    const window = resolveSyncRange(range);
    expect(window.fromMs).toBe(Date.parse("2022-01-01T00:00:00.000Z"));

    const binanceParts = syncRangesForSource("binance", range);
    const okxParts = syncRangesForSource("okx", range);
    const luncParts = syncRangesForSource("lunc_stake", range);

    expect(binanceParts.length).toBeGreaterThan(10);
    expect(okxParts.length).toBe(binanceParts.length);
    expect(luncParts).toEqual([range]);

    // Each transport window itself chunks into ≤30d Binance API windows
    const sample = resolveSyncRange(binanceParts[0]);
    const apiChunks = chunkTimeRange(sample.fromMs!, sample.toMs!);
    expect(apiChunks.length).toBeGreaterThanOrEqual(1);
    expect(apiChunks.length).toBeLessThanOrEqual(4);
  });

  it("Binance/OKX fetch each transport window; LUNC ignores range; ledger consistent", async () => {
    const { syncBinance, syncOkx, syncLuncStake, buildSyncContext } =
      await import("../../web/src/lib/sync");

    const range = buildSyncRangeFromUi("custom", "2022-01-01", "2026-07-18");
    const parts = syncRangesForSource("binance", range);

    fetchBinanceEarnEvents.mockImplementation(
      async (_creds: unknown, opts: { startMs?: number; endMs?: number }) => [
        ev({
          id: `binance:${opts.startMs}`,
          source: "binance",
          amount: "1",
          earnedAt: new Date(opts.startMs ?? 0).toISOString(),
        }),
      ],
    );
    fetchOkxEarnEvents.mockImplementation(
      async (_creds: unknown, opts: { startMs?: number; endMs?: number }) => [
        ev({
          id: `okx:${opts.startMs}`,
          source: "okx",
          amount: "2",
          earnedAt: new Date(opts.startMs ?? 0).toISOString(),
        }),
      ],
    );
    fetchLuncStakeEarnEvents.mockResolvedValue([
      ev({
        id: "lunc_stake:pending",
        source: "lunc_stake",
        asset: "LUNC",
        amount: "3",
        // Outside the custom window — still kept (point-in-time).
        earnedAt: new Date().toISOString(),
      }),
    ]);

    // Seed an out-of-window CEX row that merge must preserve.
    replaceSourceEvents("binance", {
      status: "ok",
      events: [
        ev({
          id: "binance:pre-2022",
          source: "binance",
          amount: "9",
          earnedAt: "2021-06-01T00:00:00.000Z",
        }),
      ],
    });

    for (const part of parts) {
      const ctx = buildSyncContext({ userId: "u1" }, part);
      const b = await syncBinance({ apiKey: "k", apiSecret: "s" }, ctx);
      expect(b.status).toBe("ok");
      const o = await syncOkx(
        { apiKey: "k", apiSecret: "s", passphrase: "p" },
        ctx,
      );
      expect(o.status).toBe("ok");
    }

    // LUNC: single call with the full custom range (ignored).
    const luncCtx = buildSyncContext({ userId: "u1" }, range);
    const lunc = await syncLuncStake("terra1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a", luncCtx);
    expect(lunc.status).toBe("ok");
    expect(lunc.events).toHaveLength(1);
    expect(fetchLuncStakeEarnEvents).toHaveBeenCalledTimes(1);

    // Adapters saw windowed opts for every transport part
    expect(fetchBinanceEarnEvents.mock.calls.length).toBe(parts.length);
    expect(fetchOkxEarnEvents.mock.calls.length).toBe(parts.length);
    for (const call of fetchBinanceEarnEvents.mock.calls) {
      const opts = call[1] as { startMs: number; endMs: number };
      expect(opts.startMs).toBeGreaterThanOrEqual(
        Date.parse("2022-01-01T00:00:00.000Z"),
      );
      expect(opts.endMs).toBeLessThanOrEqual(
        Date.parse("2026-07-18T23:59:59.999Z"),
      );
    }

    const ledger = getLedger();
    const ids = ledger.events.map((e) => e.id);
    expect(ids).toContain("binance:pre-2022");
    expect(ids).toContain("lunc_stake:pending");
    expect(ids.some((id) => id.startsWith("binance:") && id !== "binance:pre-2022")).toBe(
      true,
    );
    expect(ids.some((id) => id.startsWith("okx:"))).toBe(true);

    // Merge persist for CEX; replace for LUNC
    expect(
      persistSourceSync.mock.calls.some(
        (c) =>
          (c[0] as { source: string; persistMode: string }).source ===
            "binance" &&
          (c[0] as { persistMode: string }).persistMode === "merge",
      ),
    ).toBe(true);
    expect(
      persistSourceSync.mock.calls.some(
        (c) =>
          (c[0] as { source: string; persistMode: string; syncMeta?: { rangeIgnored?: boolean } })
            .source === "lunc_stake" &&
          (c[0] as { persistMode: string }).persistMode === "replace" &&
          (c[0] as { syncMeta?: { rangeIgnored?: boolean } }).syncMeta
            ?.rangeIgnored === true,
      ),
    ).toBe(true);
  });
});
