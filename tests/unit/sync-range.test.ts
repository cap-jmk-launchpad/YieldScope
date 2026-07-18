import { describe, expect, it } from "vitest";
import {
  BINANCE_MAX_WINDOW_MS,
  SyncRangeError,
  chunkTimeRange,
  eventInWindow,
  filterEventsByWindow,
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
  });
});
