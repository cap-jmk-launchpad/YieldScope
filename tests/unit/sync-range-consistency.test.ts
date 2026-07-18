import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSyncRangeFromUi,
  cexCoverageRefreshHint,
  cexEventsMatchWindow,
  filterEventsByWindow,
  ledgerEventsForDisplay,
  parseSyncRangeBody,
  resolveSyncRange,
} from "../../web/src/lib/sync-range";
import {
  replaceSourceEvents,
  resetLedger,
  getLedger,
} from "../../web/src/lib/ledger-store";
import type { EarnEvent } from "../../web/src/lib/adapters/types";

const persistSourceSync = vi.fn();
const getSourceHighWaterMs = vi.fn();

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
    loadDbLedger: vi.fn(),
  };
});

function ev(
  partial: Partial<EarnEvent> &
    Pick<EarnEvent, "id" | "source" | "earnedAt" | "amount">,
): EarnEvent {
  return {
    asset: partial.asset ?? "USDT",
    ...partial,
  };
}

describe("FE ↔ API ↔ persist ↔ display range consistency", () => {
  const original = { ...process.env };

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env = { ...original };
    process.env.USE_FIXTURE_DEMO = "1";
    persistSourceSync.mockResolvedValue({ profileId: "p1", eventCount: 1 });
    getSourceHighWaterMs.mockResolvedValue(null);
    resetLedger();
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("dashboard range body round-trips through parseSyncRangeBody", () => {
    const all = buildSyncRangeFromUi("all", "2024-01-01", "2024-01-31");
    expect(parseSyncRangeBody({ source: "binance", range: all })).toEqual({
      mode: "all",
    });

    const forced = buildSyncRangeFromUi(
      "all",
      "2024-01-01",
      "2024-01-31",
      true,
    );
    expect(
      parseSyncRangeBody({ source: "all", range: forced, forceFull: true }),
    ).toEqual({ mode: "all", forceFull: true });

    const custom = buildSyncRangeFromUi(
      "custom",
      "2019-07-18",
      "2024-07-18",
    );
    expect(parseSyncRangeBody({ source: "okx", range: custom })).toEqual({
      mode: "custom",
      from: "2019-07-18",
      to: "2024-07-18",
    });
    const window = resolveSyncRange(custom);
    expect(window.fromMs).toBe(Date.parse("2019-07-18T00:00:00.000Z"));
    expect(window.toMs).toBe(Date.parse("2024-07-18T23:59:59.999Z"));
  });

  it("resolveCexSyncPlan maps custom range to adapter bounds + merge persist", async () => {
    const { resolveCexSyncPlan } = await import("../../web/src/lib/sync");
    const window = resolveSyncRange({
      mode: "custom",
      from: "2024-01-01",
      to: "2024-03-31",
    });
    const plan = await resolveCexSyncPlan(
      { userId: "u1", window },
      "binance",
    );
    expect(plan.opts.startMs).toBe(window.fromMs);
    expect(plan.opts.endMs).toBe(window.toMs);
    expect(plan.persistMode).toBe("merge");
    expect(plan.mergeFromMs).toBe(window.fromMs);
    expect(plan.mergeToMs).toBe(window.toMs);
  });

  it("CEX custom sync keeps only in-window events and merge-persists", async () => {
    const { syncBinance } = await import("../../web/src/lib/sync");
    const range = buildSyncRangeFromUi("custom", "2024-07-02", "2024-07-02");
    const window = resolveSyncRange(range);

    // Seed older out-of-window row that merge must keep in the in-memory ledger.
    replaceSourceEvents("binance", {
      status: "ok",
      events: [
        ev({
          id: "binance:old",
          source: "binance",
          amount: "9",
          earnedAt: "2024-06-01T00:00:00.000Z",
        }),
      ],
    });

    const result = await syncBinance(
      { apiKey: "k", apiSecret: "s" },
      { userId: "u1", window },
    );
    expect(result.status).toBe("ok");
    expect(cexEventsMatchWindow(result.events, window)).toBe(true);
    expect(result.events).toHaveLength(1);

    expect(persistSourceSync).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "binance",
        persistMode: "merge",
        mergeFromMs: window.fromMs,
        mergeToMs: window.toMs,
        syncMeta: expect.objectContaining({
          rangeMode: "custom",
          rangeIgnored: false,
          pointInTime: false,
        }),
      }),
    );

    const ledger = getLedger();
    const displayed = ledgerEventsForDisplay(ledger.events);
    // Display = full ledger: out-of-window prior row still present.
    expect(displayed.some((e) => e.id === "binance:old")).toBe(true);
    expect(displayed.some((e) => e.source === "binance" && e.asset === "BTC")).toBe(
      true,
    );
    // Synced batch itself is window-bounded.
    expect(
      cexEventsMatchWindow(
        displayed.filter((e) => e.id !== "binance:old"),
        window,
      ),
    ).toBe(true);
  });

  it("LUNC respects custom range and merge-replaces inside the window", async () => {
    const { syncLuncStake } = await import("../../web/src/lib/sync");
    const window = resolveSyncRange({
      mode: "custom",
      from: "2024-07-01",
      to: "2024-07-31",
    });

    replaceSourceEvents("lunc_stake", {
      status: "ok",
      events: [
        ev({
          id: "lunc_stake:outside",
          source: "lunc_stake",
          asset: "LUNC",
          amount: "1",
          earnedAt: "2020-01-15T00:00:00.000Z",
        }),
        ev({
          id: "lunc_stake:in-window-stale",
          source: "lunc_stake",
          asset: "LUNC",
          amount: "2",
          earnedAt: "2024-07-15T00:00:00.000Z",
        }),
      ],
    });

    // Fixture demo path: pending rows dated 2024-07-01 fall inside the window.
    process.env.USE_FIXTURE_DEMO = "1";
    const result = await syncLuncStake(
      "terra1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a",
      { userId: "u1", window },
    );
    expect(result.status).toBe("ok");
    expect(result.events.length).toBeGreaterThan(0);
    expect(
      result.events.every((e) => e.earnedAt.startsWith("2024-07-01")),
    ).toBe(true);
    expect(filterEventsByWindow(result.events, window).length).toBe(
      result.events.length,
    );

    expect(persistSourceSync).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "lunc_stake",
        persistMode: "merge",
        mergeFromMs: window.fromMs,
        mergeToMs: window.toMs,
        syncMeta: expect.objectContaining({
          pointInTime: false,
          rangeIgnored: false,
          rangeMode: "custom",
        }),
      }),
    );

    const displayed = ledgerEventsForDisplay(getLedger().events).filter(
      (e) => e.source === "lunc_stake",
    );
    expect(displayed.some((e) => e.id === "lunc_stake:outside")).toBe(true);
    expect(displayed.some((e) => e.id === "lunc_stake:in-window-stale")).toBe(
      false,
    );
    expect(displayed.length).toBe(1 + result.events.length);
  });

  it("ledger-store merge + display stay consistent for a chosen window", () => {
    const window = resolveSyncRange({
      mode: "custom",
      from: "2024-07-01",
      to: "2024-07-31",
    });
    replaceSourceEvents("okx", {
      status: "ok",
      events: [
        ev({
          id: "okx:jun",
          source: "okx",
          amount: "1",
          earnedAt: "2024-06-15T00:00:00.000Z",
        }),
        ev({
          id: "okx:jul",
          source: "okx",
          amount: "2",
          earnedAt: "2024-07-15T00:00:00.000Z",
        }),
        ev({
          id: "okx:aug",
          source: "okx",
          amount: "3",
          earnedAt: "2024-08-15T00:00:00.000Z",
        }),
      ],
    });

    const incoming = [
      ev({
        id: "okx:jul-new",
        source: "okx",
        amount: "5",
        earnedAt: "2024-07-20T00:00:00.000Z",
      }),
    ];
    expect(cexEventsMatchWindow(incoming, window)).toBe(true);

    replaceSourceEvents(
      "okx",
      { status: "ok", events: incoming },
      { mergeFromMs: window.fromMs, mergeToMs: window.toMs },
    );

    const displayed = ledgerEventsForDisplay(getLedger().events);
    const ids = displayed.filter((e) => e.source === "okx").map((e) => e.id);
    expect(ids).toContain("okx:jun");
    expect(ids).toContain("okx:aug");
    expect(ids).toContain("okx:jul-new");
    expect(ids).not.toContain("okx:jul");
  });

  it("cexCoverageRefreshHint flags dense few-day CEX history", () => {
    const events = Array.from({ length: 60 }, (_, i) =>
      ev({
        id: `binance:${i}`,
        source: "binance",
        amount: "1",
        earnedAt: `2024-07-01T${String(i % 24).padStart(2, "0")}:00:00.000Z`,
      }),
    );
    expect(cexCoverageRefreshHint(events)).toMatch(/few days/i);
    expect(
      cexCoverageRefreshHint([
        ev({
          id: "a",
          source: "binance",
          amount: "1",
          earnedAt: "2020-01-01T00:00:00.000Z",
        }),
        ev({
          id: "b",
          source: "binance",
          amount: "1",
          earnedAt: "2024-01-01T00:00:00.000Z",
        }),
      ]),
    ).toBeNull();
  });
});
