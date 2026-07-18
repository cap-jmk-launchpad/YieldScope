import { describe, expect, it } from "vitest";
import {
  BINANCE_MAX_WINDOW_MS,
  SyncRangeError,
  buildSyncRangeFromUi,
  cexCoverageRefreshHint,
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
    expect(isPointInTimeSource("lunc_stake")).toBe(true);
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
});
