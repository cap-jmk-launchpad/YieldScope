import { describe, expect, it } from "vitest";
import {
  getLedger,
  replaceSourceEvents,
  resetLedger,
} from "../../web/src/lib/ledger-store";

describe("ledger-store", () => {
  it("starts empty and replaces per source", () => {
    resetLedger();
    const empty = getLedger();
    expect(empty.events).toEqual([]);
    expect(empty.sources.binance.status).toBe("not_connected");

    replaceSourceEvents("binance", {
      status: "ok",
      events: [
        {
          id: "binance:1",
          source: "binance",
          asset: "USDT",
          amount: "1",
          earnedAt: "2024-07-01T00:00:00.000Z",
        },
      ],
    });
    const snap = getLedger();
    expect(snap.events).toHaveLength(1);
    expect(snap.sources.binance.status).toBe("ok");
    expect(snap.sources.binance.eventCount).toBe(1);

    replaceSourceEvents("binance", {
      status: "error",
      events: [],
      error: "boom",
    });
    expect(getLedger().events).toHaveLength(0);
    expect(getLedger().sources.binance.error).toBe("boom");

    replaceSourceEvents("binance", {
      status: "ok",
      events: [
        {
          id: "binance:2",
          source: "binance",
          asset: "USDT",
          amount: "2",
          earnedAt: "2024-07-02T00:00:00.000Z",
        },
      ],
    });
    expect(getLedger().sources.binance.status).toBe("ok");
    expect(getLedger().sources.binance.error).toBeUndefined();
  });

  it("merge window keeps events outside the synced range", () => {
    resetLedger();
    replaceSourceEvents("binance", {
      status: "ok",
      events: [
        {
          id: "binance:old",
          source: "binance",
          asset: "USDT",
          amount: "1",
          earnedAt: "2024-06-01T00:00:00.000Z",
        },
        {
          id: "binance:mid",
          source: "binance",
          asset: "USDT",
          amount: "2",
          earnedAt: "2024-07-15T00:00:00.000Z",
        },
        {
          id: "binance:new",
          source: "binance",
          asset: "USDT",
          amount: "3",
          earnedAt: "2024-08-01T00:00:00.000Z",
        },
      ],
    });
    replaceSourceEvents(
      "binance",
      {
        status: "ok",
        events: [
          {
            id: "binance:mid2",
            source: "binance",
            asset: "USDT",
            amount: "9",
            earnedAt: "2024-07-15T12:00:00.000Z",
          },
        ],
      },
      {
        mergeFromMs: Date.parse("2024-07-01T00:00:00.000Z"),
        mergeToMs: Date.parse("2024-07-31T23:59:59.999Z"),
      },
    );
    const ids = getLedger().events.map((e) => e.id).sort();
    expect(ids).toEqual(["binance:mid2", "binance:new", "binance:old"]);
  });

  it("upsertOnly replaces matching ids and keeps the rest", () => {
    resetLedger();
    replaceSourceEvents("okx", {
      status: "ok",
      events: [
        {
          id: "okx:1",
          source: "okx",
          asset: "USDT",
          amount: "1",
          earnedAt: "2024-07-01T00:00:00.000Z",
        },
        {
          id: "okx:2",
          source: "okx",
          asset: "USDT",
          amount: "2",
          earnedAt: "2024-07-02T00:00:00.000Z",
        },
      ],
    });
    replaceSourceEvents(
      "okx",
      {
        status: "ok",
        events: [
          {
            id: "okx:1",
            source: "okx",
            asset: "USDT",
            amount: "10",
            earnedAt: "2024-07-01T00:00:00.000Z",
          },
        ],
      },
      { upsertOnly: true },
    );
    const snap = getLedger();
    expect(snap.events).toHaveLength(2);
    expect(snap.events.find((e) => e.id === "okx:1")?.amount).toBe("10");
    expect(snap.events.find((e) => e.id === "okx:2")?.amount).toBe("2");
  });
});
