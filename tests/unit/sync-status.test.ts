import { describe, expect, it } from "vitest";
import {
  SYNC_SESSION_STALE_MS,
  formatSyncingOverview,
  isSyncSessionFresh,
  resolveUiSourceStatus,
  sourceErrorForDisplay,
  sourcesForSyncTarget,
} from "../../web/src/lib/sync-status";

describe("sync-status helpers", () => {
  it("expands all → every source", () => {
    expect(sourcesForSyncTarget("all")).toEqual([
      "binance",
      "okx",
      "monad_stake",
      "lunc_stake",
    ]);
    expect(sourcesForSyncTarget("binance")).toEqual(["binance"]);
  });

  it("prefers syncing overlay over persisted status", () => {
    expect(resolveUiSourceStatus("error", true)).toBe("syncing");
    expect(resolveUiSourceStatus("ok", false)).toBe("ok");
    expect(resolveUiSourceStatus(undefined, false)).toBe("not_connected");
  });

  it("only shows errors for failing sources", () => {
    expect(sourceErrorForDisplay("ok", "old failure")).toBeUndefined();
    expect(sourceErrorForDisplay("not_connected", "Not connected")).toBeUndefined();
    expect(sourceErrorForDisplay("error", "API key invalid")).toBe(
      "API key invalid",
    );
    expect(sourceErrorForDisplay("error", undefined)).toBe("Sync failed");
  });

  it("formats sync overview copy", () => {
    expect(formatSyncingOverview([])).toBeNull();
    expect(formatSyncingOverview(["binance"])).toBe("Syncing Binance…");
    expect(formatSyncingOverview(["binance", "okx"])).toBe(
      "Syncing Binance, OKX…",
    );
  });

  it("detects stale sync sessions", () => {
    const now = Date.parse("2024-07-01T12:00:00.000Z");
    expect(
      isSyncSessionFresh(
        {
          startedAt: new Date(now - 60_000).toISOString(),
          sources: ["binance"],
          pending: ["binance"],
        },
        now,
      ),
    ).toBe(true);
    expect(
      isSyncSessionFresh(
        {
          startedAt: new Date(now - SYNC_SESSION_STALE_MS - 1).toISOString(),
          sources: ["binance"],
          pending: ["binance"],
        },
        now,
      ),
    ).toBe(false);
  });
});
