import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const dummyCex = { apiKey: "k", apiSecret: "s" };
const dummyOkx = { apiKey: "k", apiSecret: "s", passphrase: "p" };

describe("sync with persistence", () => {
  const original = { ...process.env };

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env = { ...original };
    process.env.USE_FIXTURE_DEMO = "1";
    persistSourceSync.mockResolvedValue({ profileId: "p1", eventCount: 1 });
    getSourceHighWaterMs.mockResolvedValue(null);
    const { resetLedger } = await import("../../web/src/lib/ledger-store");
    resetLedger();
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("syncBinance fixture persists and returns ok", async () => {
    const { syncBinance, snapshot } = await import("../../web/src/lib/sync");
    const result = await syncBinance(dummyCex, {
      userId: "u1",
      email: "a@b.c",
    });
    expect(result.status).toBe("ok");
    expect(result.events.length).toBeGreaterThan(0);
    expect(persistSourceSync).toHaveBeenCalled();
    expect(snapshot().sources.binance.status).toBe("ok");
  });

  it("syncOkx fixture persists", async () => {
    const { syncOkx } = await import("../../web/src/lib/sync");
    const result = await syncOkx(dummyOkx, { userId: "u1" });
    expect(result.status).toBe("ok");
    expect(result.events.length).toBeGreaterThan(0);
    expect(persistSourceSync).toHaveBeenCalledWith(
      expect.objectContaining({ source: "okx", userId: "u1" }),
    );
  });

  it("syncMonadStake fixture persists wallet", async () => {
    const { syncMonadStake } = await import("../../web/src/lib/sync");
    const addr = "0x0000000000000000000000000000000000000001" as const;
    const result = await syncMonadStake(addr, {
      userId: "u1",
      chainId: 10143,
    });
    expect(result.status).toBe("ok");
    expect(result.events.some((e) => e.amount === "2.5")).toBe(true);
    expect(persistSourceSync).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "monad_stake",
        walletAddress: addr,
      }),
    );
  });

  it("fixture mode without wallet never invents 2.5 MONAD", async () => {
    const { syncMonadStake, snapshot } = await import("../../web/src/lib/sync");
    const result = await syncMonadStake(null, { userId: "u1" });
    expect(result.status).toBe("not_connected");
    expect(result.events).toEqual([]);
    expect(result.events.some((e) => e.amount === "2.5")).toBe(false);
    expect(persistSourceSync).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "monad_stake",
        status: "not_connected",
        events: [],
        walletAddress: null,
      }),
    );
    expect(snapshot().sources.monad_stake.status).toBe("not_connected");
  });

  it("fixture mode without CEX/LUNC creds stays not_connected", async () => {
    const { syncBinance, syncOkx, syncLuncStake } = await import(
      "../../web/src/lib/sync"
    );
    expect((await syncBinance(null, { userId: "u1" })).status).toBe(
      "not_connected",
    );
    expect((await syncOkx(null, { userId: "u1" })).status).toBe("not_connected");
    expect((await syncLuncStake(null, { userId: "u1" })).status).toBe(
      "not_connected",
    );
  });

  it("fails closed when persist fails", async () => {
    const { LedgerPersistError } = await import("../../web/src/lib/ledger-db");
    persistSourceSync.mockRejectedValueOnce(new LedgerPersistError("db down"));
    const { syncBinance } = await import("../../web/src/lib/sync");
    const result = await syncBinance(dummyCex, { userId: "u1" });
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/Couldn’t save this source/i);
  });

  it("not_connected without creds outside fixture mode", async () => {
    process.env.USE_FIXTURE_DEMO = "0";
    const { syncBinance, syncOkx, syncMonadStake, syncLuncStake } =
      await import("../../web/src/lib/sync");
    expect((await syncBinance(null, { userId: "u1" })).status).toBe(
      "not_connected",
    );
    expect((await syncOkx(null, { userId: "u1" })).status).toBe("not_connected");
    expect((await syncMonadStake(null, { userId: "u1" })).status).toBe(
      "not_connected",
    );
    expect((await syncLuncStake(null, { userId: "u1" })).status).toBe(
      "not_connected",
    );
  });

  it("syncLuncStake fixture persists", async () => {
    const { syncLuncStake } = await import("../../web/src/lib/sync");
    const result = await syncLuncStake(
      "terra1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a",
      { userId: "u1" },
    );
    expect(result.status).toBe("ok");
    expect(result.events.length).toBeGreaterThan(0);
    expect(persistSourceSync).toHaveBeenCalledWith(
      expect.objectContaining({ source: "lunc_stake" }),
    );
  });

  it("live binance sync uses fetch when fixtures off", async () => {
    process.env.USE_FIXTURE_DEMO = "0";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          rows: [
            { asset: "USDT", rewards: "1", time: 1719792000000 },
          ],
          total: 1,
        }),
      }),
    );
    const { syncBinance } = await import("../../web/src/lib/sync");
    const result = await syncBinance(
      { apiKey: "k", apiSecret: "s" },
      { userId: "u1" },
    );
    expect(result.status).toBe("ok");
    expect(result.events).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it("syncBinance all-time first run passes allTime to adapter", async () => {
    process.env.USE_FIXTURE_DEMO = "0";
    getSourceHighWaterMs.mockResolvedValue(null);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rows: [], total: 0 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { syncBinance } = await import("../../web/src/lib/sync");
    const { resolveSyncRange } = await import("../../web/src/lib/sync-range");
    await syncBinance(
      { apiKey: "k", apiSecret: "s" },
      { userId: "u1", window: resolveSyncRange({ mode: "all" }) },
    );
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("type=ALL");
    vi.unstubAllGlobals();
  });

  it("syncBinance incremental uses high-water and upserts", async () => {
    process.env.USE_FIXTURE_DEMO = "0";
    const now = Date.now();
    const highWater = now - 60 * 60 * 1000; // 1h ago — typical after first sync
    getSourceHighWaterMs.mockResolvedValue(highWater);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        rows: [
          {
            asset: "USDT",
            rewards: "1",
            time: highWater + 60_000,
            projectId: "p1",
          },
        ],
        total: 1,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { syncBinance } = await import("../../web/src/lib/sync");
    const { INCREMENTAL_OVERLAP_MS } = await import(
      "../../web/src/lib/sync-range"
    );
    await syncBinance(
      { apiKey: "k", apiSecret: "s" },
      {
        userId: "u1",
        window: { mode: "all", fromMs: null, toMs: null },
      },
    );
    const url = String(fetchMock.mock.calls[0][0]);
    const expectedStart = highWater - INCREMENTAL_OVERLAP_MS;
    expect(url).toContain(`startTime=${expectedStart}`);
    expect(url).toContain("type=ALL");
    expect(persistSourceSync).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "binance",
        persistMode: "upsert",
      }),
    );
    vi.unstubAllGlobals();
  });

  it("syncBinance forceFull ignores high-water and replaces", async () => {
    process.env.USE_FIXTURE_DEMO = "0";
    getSourceHighWaterMs.mockResolvedValue(Date.parse("2024-07-01T00:00:00.000Z"));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rows: [], total: 0 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { syncBinance } = await import("../../web/src/lib/sync");
    await syncBinance(
      { apiKey: "k", apiSecret: "s" },
      {
        userId: "u1",
        window: { mode: "all", fromMs: null, toMs: null },
        forceFull: true,
      },
    );
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(persistSourceSync).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "binance",
        persistMode: "replace",
      }),
    );
    vi.unstubAllGlobals();
  });

  it("re-sync does not duplicate in-memory ledger events", async () => {
    const { syncBinance, snapshot } = await import("../../web/src/lib/sync");
    const { resetLedger } = await import("../../web/src/lib/ledger-store");
    resetLedger();
    getSourceHighWaterMs.mockResolvedValue(null);
    await syncBinance(dummyCex, { userId: "u1" });
    const firstCount = snapshot().events.filter((e) => e.source === "binance")
      .length;
    getSourceHighWaterMs.mockResolvedValue(
      Date.parse(snapshot().events[0].earnedAt),
    );
    await syncBinance(dummyCex, { userId: "u1" });
    const second = snapshot().events.filter((e) => e.source === "binance");
    const ids = second.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(second.length).toBe(firstCount);
  });

  it("syncBinance custom range filters fixture events", async () => {
    const { syncBinance } = await import("../../web/src/lib/sync");
    const { resolveSyncRange } = await import("../../web/src/lib/sync-range");
    // Fixture has 2024-07-01 and 2024-07-02 events
    const result = await syncBinance(dummyCex, {
      userId: "u1",
      window: resolveSyncRange({
        mode: "custom",
        from: "2024-07-02",
        to: "2024-07-02",
      }),
    });
    expect(result.status).toBe("ok");
    expect(result.events).toHaveLength(1);
    expect(result.events[0].asset).toBe("BTC");
    expect(persistSourceSync).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "binance",
        persistMode: "merge",
        mergeFromMs: expect.any(Number),
        mergeToMs: expect.any(Number),
      }),
    );
  });

  it("syncBinance all-time first run uses replace persist", async () => {
    const { syncBinance } = await import("../../web/src/lib/sync");
    const { resolveSyncRange } = await import("../../web/src/lib/sync-range");
    getSourceHighWaterMs.mockResolvedValue(null);
    await syncBinance(dummyCex, {
      userId: "u1",
      window: resolveSyncRange({ mode: "all" }),
    });
    const arg = persistSourceSync.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(arg.source).toBe("binance");
    expect(arg.persistMode).toBe("replace");
    expect(arg).not.toHaveProperty("mergeFromMs");
    expect(arg).not.toHaveProperty("mergeToMs");
  });

  it("live sync surfaces adapter errors", async () => {
    process.env.USE_FIXTURE_DEMO = "0";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "err",
      }),
    );
    const { syncOkx } = await import("../../web/src/lib/sync");
    const result = await syncOkx(
      { apiKey: "k", apiSecret: "s", passphrase: "p" },
      { userId: "u1" },
    );
    expect(result.status).toBe("error");
    vi.unstubAllGlobals();
  });

  it("live lunc sync uses LCD fetch", async () => {
    process.env.USE_FIXTURE_DEMO = "0";
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const payload = JSON.parse(
      readFileSync(join("tests/fixtures/lunc/rewards-sample.json"), "utf8"),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => payload,
      }),
    );
    const { syncLuncStake } = await import("../../web/src/lib/sync");
    const result = await syncLuncStake(
      "terra1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a",
      { userId: "u1" },
    );
    expect(result.status).toBe("ok");
    expect(result.events.length).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });

  it("live lunc sync maps adapter failures to user-facing errors", async () => {
    process.env.USE_FIXTURE_DEMO = "0";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => "LCD down",
      }),
    );
    const { syncLuncStake } = await import("../../web/src/lib/sync");
    const result = await syncLuncStake(
      "terra1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a",
      { userId: "u1" },
    );
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/LUNC staking rewards/i);
    vi.unstubAllGlobals();
  });

  it("buildSyncContext resolves window and forceFull", async () => {
    const { buildSyncContext } = await import("../../web/src/lib/sync");
    const ctx = buildSyncContext(
      { userId: "u1" },
      { mode: "custom", from: "2024-01-01", to: "2024-01-31", forceFull: true },
    );
    expect(ctx.window?.mode).toBe("custom");
    expect(ctx.forceFull).toBe(true);
    const all = buildSyncContext({ userId: "u1" });
    expect(all.window?.mode).toBe("all");
    expect(all.forceFull).toBe(false);
  });

  it("resolveCexSyncPlan treats high-water errors as cold start", async () => {
    getSourceHighWaterMs.mockRejectedValueOnce(new Error("db"));
    const { resolveCexSyncPlan } = await import("../../web/src/lib/sync");
    const plan = await resolveCexSyncPlan({ userId: "u1" }, "binance");
    expect(plan.persistMode).toBe("replace");
    expect(plan.opts.allTime).toBe(true);
  });

  it("live okx success and binance empty-message fallback", async () => {
    process.env.USE_FIXTURE_DEMO = "0";
    process.env.OKX_API_BASE = "https://www.okx.com";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          code: "0",
          data: [
            { ccy: "USDT", amt: "1", ts: "1719792000000", productId: "p1" },
          ],
        }),
      }),
    );
    const { syncOkx, syncBinance, userFacingAdapterError } = await import(
      "../../web/src/lib/sync"
    );
    const { BinanceAdapterError } = await import(
      "../../web/src/lib/adapters/binance"
    );
    const okx = await syncOkx(dummyOkx, { userId: "u1" });
    expect(okx.status).toBe("ok");
    expect(okx.events).toHaveLength(1);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("")),
    );
    const binance = await syncBinance(dummyCex, { userId: "u1" });
    expect(binance.status).toBe("error");
    expect(binance.error).toMatch(/Binance earn history/i);

    // Adapter errors with "malformed" must not be scrubbed to the generic hint.
    expect(
      userFacingAdapterError(
        new BinanceAdapterError("Malformed Binance reward row"),
        "FALLBACK",
      ),
    ).toBe("Malformed Binance reward row");
    vi.unstubAllGlobals();
  });

  it("fixturesRoot resolves when cwd ends with /web", async () => {
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(
      "C:\\Users\\Julian\\Documents\\Programming\\hackathons\\buildanything.so\\web",
    );
    process.env.USE_FIXTURE_DEMO = "1";
    const { syncBinance } = await import("../../web/src/lib/sync");
    const result = await syncBinance(dummyCex, { userId: "u1" });
    expect(result.status).toBe("ok");
    cwdSpy.mockRestore();
  });

  it("userFacingAdapterError keeps non-infra raw strings", async () => {
    process.env.USE_FIXTURE_DEMO = "0";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue("plain-string-failure"),
    );
    const { syncBinance, userFacingAdapterError } = await import(
      "../../web/src/lib/sync"
    );
    const result = await syncBinance(dummyCex, { userId: "u1" });
    expect(result.status).toBe("error");
    expect(result.error).toBe("plain-string-failure");
    // Untyped exchange / auth hints must stay verbatim (not scrubbed to fallback).
    expect(
      userFacingAdapterError(new Error("OKX HTTP 401: nope"), "FALLBACK"),
    ).toBe("OKX HTTP 401: nope");
    expect(
      userFacingAdapterError(new Error("error 50119 on region"), "FALLBACK"),
    ).toBe("error 50119 on region");
    expect(
      userFacingAdapterError(new Error("Please re-save passphrase"), "FALLBACK"),
    ).toBe("Please re-save passphrase");
    expect(
      userFacingAdapterError(new Error("LCD eth_call failed"), "FALLBACK"),
    ).toBe("FALLBACK");
    vi.unstubAllGlobals();
  });
});
