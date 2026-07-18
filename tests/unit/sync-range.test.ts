import { describe, expect, it } from "vitest";
import {
  BINANCE_MAX_WINDOW_MS,
  SyncRangeError,
  buildSyncRangeFromUi,
  cexCoverageRefreshHint,
  cexCoverageRefreshHintFromAggregates,
  cexEventsMatchWindow,
  chunkTimeRange,
  eventInWindow,
  filterEventsByWindow,
  isPointInTimeSource,
  ledgerEventsForDisplay,
  parseSyncRangeBody,
  resolveSyncRange,
} from "../../web/src/lib/sync-range";

describe("sync-range", () => {
  it("resolves all-time as unbounded", () => {
    expect(resolveSyncRange({ mode: "all" })).toEqual({
      mode: "all",
      fromMs: null,
      toMs: null,
    });
    expect(resolveSyncRange(undefined)).toEqual({
      mode: "all",
      fromMs: null,
      toMs: null,
    });
  });

  it("resolves custom YYYY-MM-DD as UTC day bounds", () => {
    const w = resolveSyncRange({
      mode: "custom",
      from: "2024-07-01",
      to: "2024-07-31",
    });
    expect(w.mode).toBe("custom");
    expect(w.fromMs).toBe(Date.parse("2024-07-01T00:00:00.000Z"));
    expect(w.toMs).toBe(Date.parse("2024-07-31T23:59:59.999Z"));
  });

  it("accepts European DD.MM.YYYY date bounds", () => {
    const w = resolveSyncRange({
      mode: "custom",
      from: "01.01.2022",
      to: "18.07.2026",
    });
    expect(w.fromMs).toBe(Date.parse("2022-01-01T00:00:00.000Z"));
    expect(w.toMs).toBe(Date.parse("2026-07-18T23:59:59.999Z"));
    expect(buildSyncRangeFromUi("custom", "01.01.2022", "18/07/2026")).toEqual({
      mode: "custom",
      from: "2022-01-01",
      to: "2026-07-18",
    });
  });

  it("splits multi-year custom ranges into ≤90-day transport windows", async () => {
    const { splitCustomRangeForTransport, syncRangesForSource, CEX_TRANSPORT_MAX_SPAN_MS } =
      await import("../../web/src/lib/sync-range");
    const parts = splitCustomRangeForTransport("2022-01-01", "2026-07-18");
    expect(parts.length).toBeGreaterThan(10);
    expect(parts[0].from).toBe("2022-01-01");
    expect(parts.at(-1)?.to).toBe("2026-07-18");
    for (const p of parts) {
      const w = resolveSyncRange(p);
      expect(w.toMs! - w.fromMs!).toBeLessThanOrEqual(CEX_TRANSPORT_MAX_SPAN_MS);
    }
    // LUNC also splits multi-year custom ranges (≤90d transport windows)
    expect(
      syncRangesForSource("lunc_stake", {
        mode: "custom",
        from: "2022-01-01",
        to: "2026-07-18",
      }).length,
    ).toBeGreaterThan(10);
    // Monad stays a single call (point-in-time)
    expect(
      syncRangesForSource("monad_stake", {
        mode: "custom",
        from: "2022-01-01",
        to: "2026-07-18",
      }),
    ).toHaveLength(1);
    // Binance gets split
    expect(
      syncRangesForSource("binance", {
        mode: "custom",
        from: "2022-01-01",
        to: "2026-07-18",
      }).length,
    ).toBeGreaterThan(10);
    // Short CEX custom range stays a single transport window
    expect(
      syncRangesForSource("binance", {
        mode: "custom",
        from: "2024-07-01",
        to: "2024-07-15",
      }),
    ).toEqual([{ mode: "custom", from: "2024-07-01", to: "2024-07-15" }]);
    expect(
      syncRangesForSource("okx", { mode: "all" }),
    ).toEqual([{ mode: "all" }]);
  });

  it("rejects inverted or incomplete custom ranges", () => {
    expect(() =>
      resolveSyncRange({ mode: "custom", from: "2024-08-01", to: "2024-07-01" }),
    ).toThrow(SyncRangeError);
    expect(() => resolveSyncRange({ mode: "custom", from: "2024-07-01" })).toThrow(
      SyncRangeError,
    );
  });

  it("filters events by window", () => {
    const window = resolveSyncRange({
      mode: "custom",
      from: "2024-07-01",
      to: "2024-07-15",
    });
    const events = [
      { earnedAt: "2024-06-30T12:00:00.000Z" },
      { earnedAt: "2024-07-01T00:00:00.000Z" },
      { earnedAt: "2024-07-10T00:00:00.000Z" },
      { earnedAt: "2024-07-16T00:00:00.000Z" },
    ];
    expect(filterEventsByWindow(events, window)).toHaveLength(2);
    expect(eventInWindow("2024-07-10T00:00:00.000Z", window)).toBe(true);
    expect(eventInWindow("2024-06-01T00:00:00.000Z", window)).toBe(false);
  });

  it("chunks ranges into ≤30-day Binance windows", () => {
    const from = Date.parse("2024-01-01T00:00:00.000Z");
    const to = Date.parse("2024-03-15T00:00:00.000Z");
    const chunks = chunkTimeRange(from, to);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.endMs - c.startMs).toBeLessThanOrEqual(BINANCE_MAX_WINDOW_MS - 1 + 1);
      expect(c.endMs - c.startMs + 1).toBeLessThanOrEqual(BINANCE_MAX_WINDOW_MS);
    }
    expect(chunks[chunks.length - 1].startMs).toBe(from);
    expect(chunks[0].endMs).toBe(to);
  });

  it("chunks a multi-year custom window without truncating", () => {
    const from = Date.parse("2019-07-01T00:00:00.000Z");
    const to = Date.parse("2024-07-01T23:59:59.999Z");
    const chunks = chunkTimeRange(from, to);
    expect(chunks.length).toBeGreaterThan(50);
    expect(chunks[0].endMs).toBe(to);
    expect(chunks[chunks.length - 1].startMs).toBe(from);
    // contiguous coverage: each next chunk ends just before prior start
    for (let i = 0; i < chunks.length - 1; i += 1) {
      expect(chunks[i + 1].endMs).toBe(chunks[i].startMs - 1);
    }
  });

  it("parses range from API body", () => {
    expect(parseSyncRangeBody({ range: { mode: "all" } })).toEqual({
      mode: "all",
    });
    expect(
      parseSyncRangeBody({
        range: { mode: "custom", from: "2024-01-01", to: "2024-01-31" },
      }),
    ).toEqual({
      mode: "custom",
      from: "2024-01-01",
      to: "2024-01-31",
    });
    expect(parseSyncRangeBody({ source: "all" })).toBeUndefined();
    expect(
      parseSyncRangeBody({ range: { mode: "all" }, forceFull: true }),
    ).toEqual({ mode: "all", forceFull: true });
    expect(
      parseSyncRangeBody({ range: { mode: "all", forceFull: true } }),
    ).toEqual({ mode: "all", forceFull: true });
  });

  it("covers flat body, forceFull strings, and invalid range", () => {
    expect(parseSyncRangeBody(null)).toBeUndefined();
    expect(parseSyncRangeBody("x")).toBeUndefined();
    expect(parseSyncRangeBody({ mode: "all" })).toEqual({ mode: "all" });
    expect(parseSyncRangeBody({ mode: "all", forceFull: "true" })).toEqual({
      mode: "all",
      forceFull: true,
    });
    expect(parseSyncRangeBody({ forceFull: 1 })).toEqual({
      mode: "all",
      forceFull: true,
    });
    expect(parseSyncRangeBody({ from: "2024-01-01", to: "2024-01-02" })).toEqual({
      mode: "custom",
      from: "2024-01-01",
      to: "2024-01-02",
    });
    expect(parseSyncRangeBody({ from: "2024-01-01" })).toEqual({
      mode: "custom",
      from: "2024-01-01",
      to: undefined,
    });
    expect(() => parseSyncRangeBody({ range: "bad" })).toThrow(SyncRangeError);
    expect(
      resolveSyncRange({
        mode: "custom",
        from: "2024-07-01T12:00:00.000Z",
        to: "2024-07-02T12:00:00.000Z",
      }),
    ).toEqual({
      mode: "custom",
      fromMs: Date.parse("2024-07-01T12:00:00.000Z"),
      toMs: Date.parse("2024-07-02T12:00:00.000Z"),
    });
    expect(() =>
      resolveSyncRange({ mode: "custom", from: "nope", to: "2024-01-01" }),
    ).toThrow(SyncRangeError);
    expect(chunkTimeRange(10, 5)).toEqual([]);
    expect(eventInWindow("not-a-date", {
      mode: "custom",
      fromMs: 1,
      toMs: 2,
    })).toBe(false);
    expect(
      eventInWindow("2024-01-01T00:00:00.000Z", {
        mode: "all",
        fromMs: null,
        toMs: null,
      }),
    ).toBe(true);
  });

  it("buildSyncRangeFromUi and point-in-time helpers", () => {
    expect(buildSyncRangeFromUi("all", "a", "b")).toEqual({ mode: "all" });
    expect(buildSyncRangeFromUi("all", "a", "b", true)).toEqual({
      mode: "all",
      forceFull: true,
    });
    expect(buildSyncRangeFromUi("custom", "2024-01-01", "2024-01-02")).toEqual({
      mode: "custom",
      from: "2024-01-01",
      to: "2024-01-02",
    });
    expect(isPointInTimeSource("lunc_stake")).toBe(false);
    expect(isPointInTimeSource("monad_stake")).toBe(true);
    expect(isPointInTimeSource("binance")).toBe(false);
    expect(ledgerEventsForDisplay([{ id: 1 }, { id: 2 }])).toEqual([
      { id: 1 },
      { id: 2 },
    ]);
    const window = resolveSyncRange({
      mode: "custom",
      from: "2024-07-01",
      to: "2024-07-01",
    });
    expect(
      cexEventsMatchWindow(
        [
          { source: "binance", earnedAt: "2024-07-01T12:00:00.000Z" },
          { source: "lunc_stake", earnedAt: "2025-01-01T00:00:00.000Z" },
        ],
        window,
      ),
    ).toBe(true);
    expect(
      cexEventsMatchWindow(
        [{ source: "okx", earnedAt: "2024-06-01T00:00:00.000Z" }],
        window,
      ),
    ).toBe(false);
    expect(cexCoverageRefreshHint([])).toBeNull();
  });

  it("cexCoverageRefreshHintFromAggregates uses first/last earned", () => {
    expect(
      cexCoverageRefreshHintFromAggregates([
        {
          source: "binance",
          eventCount: 100,
          firstEarnedAt: "2024-07-01T00:00:00.000Z",
          lastEarnedAt: "2024-07-02T00:00:00.000Z",
        },
      ]),
    ).toMatch(/few days/i);
    expect(
      cexCoverageRefreshHintFromAggregates([
        {
          source: "binance",
          eventCount: 100,
          firstEarnedAt: "2022-01-01T00:00:00.000Z",
          lastEarnedAt: "2024-07-01T00:00:00.000Z",
        },
      ]),
    ).toBeNull();
    expect(
      cexCoverageRefreshHintFromAggregates([
        { source: "binance", eventCount: 10, firstEarnedAt: null, lastEarnedAt: null },
      ]),
    ).toBeNull();
    // Skip non-CEX sources while still counting CEX rows
    expect(
      cexCoverageRefreshHintFromAggregates([
        {
          source: "lunc_stake",
          eventCount: 999,
          firstEarnedAt: "2020-01-01T00:00:00.000Z",
          lastEarnedAt: "2024-01-01T00:00:00.000Z",
        },
        {
          source: "okx",
          eventCount: 60,
          firstEarnedAt: "2024-07-01T00:00:00.000Z",
          lastEarnedAt: "2024-07-02T00:00:00.000Z",
        },
      ]),
    ).toMatch(/few days/i);
    // Enough CEX events but unparseable dates → null (non-finite min/max)
    expect(
      cexCoverageRefreshHintFromAggregates([
        {
          source: "binance",
          eventCount: 80,
          firstEarnedAt: "not-a-date",
          lastEarnedAt: null,
        },
      ]),
    ).toBeNull();
  });
});
