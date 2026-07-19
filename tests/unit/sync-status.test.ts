import { describe, expect, it } from "vitest";
import {
  SYNC_SESSION_STALE_MS,
  formatSyncingOverview,
  isSyncSessionFresh,
  ledgerHasSyncedHistory,
  resolveUiSourceStatus,
  shouldAutoImportMissing,
  sourceErrorForDisplay,
  sourceInfoForDisplay,
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

  it("treats a live wallet as connected when sync never ran", () => {
    expect(
      resolveUiSourceStatus("not_connected", false, { liveConnected: true }),
    ).toBe("ok");
    expect(
      resolveUiSourceStatus(undefined, false, { liveConnected: true }),
    ).toBe("ok");
    // Real sync outcomes still win over live-wallet hydration.
    expect(
      resolveUiSourceStatus("error", false, { liveConnected: true }),
    ).toBe("error");
    expect(resolveUiSourceStatus("ok", false, { liveConnected: true })).toBe(
      "ok",
    );
  });

  it("only shows errors for failing sources", () => {
    expect(sourceErrorForDisplay("ok", "old failure")).toBeUndefined();
    expect(sourceErrorForDisplay("not_connected", "Not connected")).toBeUndefined();
    expect(sourceErrorForDisplay("error", "API key invalid")).toBe(
      "API key invalid",
    );
    expect(sourceErrorForDisplay("error", undefined)).toBe("Sync failed");
  });

  it("shows soft info only when status is ok", () => {
    expect(sourceInfoForDisplay("ok", "No stake found")).toBe("No stake found");
    expect(sourceInfoForDisplay("error", "No stake found")).toBeUndefined();
    expect(sourceInfoForDisplay("ok", "  ")).toBeUndefined();
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

  it("ledgerHasSyncedHistory detects prior earn rows", () => {
    expect(ledgerHasSyncedHistory(null)).toBe(false);
    expect(
      ledgerHasSyncedHistory({
        binance: { status: "not_connected", eventCount: 0 },
      }),
    ).toBe(false);
    expect(
      ledgerHasSyncedHistory({
        binance: { status: "ok", eventCount: 3 },
      }),
    ).toBe(true);
    expect(
      ledgerHasSyncedHistory({
        okx: { status: "error", eventCount: 0, lastSyncedAt: "2024-07-01" },
      }),
    ).toBe(true);
  });

  it("shouldAutoImportMissing gates quiet incremental sync", () => {
    const base = {
      rangeMode: "all" as const,
      forceFull: false,
      autoImportMissing: true,
      hasSyncedHistory: true,
      ready: true,
      blocked: false,
    };
    expect(shouldAutoImportMissing(base)).toBe(true);
    expect(shouldAutoImportMissing({ ...base, rangeMode: "custom" })).toBe(
      false,
    );
    expect(shouldAutoImportMissing({ ...base, forceFull: true })).toBe(false);
    expect(
      shouldAutoImportMissing({ ...base, autoImportMissing: false }),
    ).toBe(false);
    expect(
      shouldAutoImportMissing({ ...base, hasSyncedHistory: false }),
    ).toBe(false);
    expect(shouldAutoImportMissing({ ...base, ready: false })).toBe(false);
    expect(shouldAutoImportMissing({ ...base, blocked: true })).toBe(false);
    expect(shouldAutoImportMissing({ ...base, rangeMode: null })).toBe(false);
  });
});
