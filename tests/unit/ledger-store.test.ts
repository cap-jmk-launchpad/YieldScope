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
  });
});
