import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const persistSourceSync = vi.fn();

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
    loadDbLedger: vi.fn(),
  };
});

describe("sync with persistence", () => {
  const original = { ...process.env };

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env = { ...original };
    process.env.USE_FIXTURE_DEMO = "1";
    persistSourceSync.mockResolvedValue({ profileId: "p1", eventCount: 1 });
    const { resetLedger } = await import("../../web/src/lib/ledger-store");
    resetLedger();
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("syncBinance fixture persists and returns ok", async () => {
    const { syncBinance, snapshot } = await import("../../web/src/lib/sync");
    const result = await syncBinance(null, {
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
    const result = await syncOkx(null, { userId: "u1" });
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
    expect(result.events.length).toBeGreaterThan(0);
    expect(persistSourceSync).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "monad_stake",
        walletAddress: addr,
      }),
    );
  });

  it("fails closed when persist fails", async () => {
    const { LedgerPersistError } = await import("../../web/src/lib/ledger-db");
    persistSourceSync.mockRejectedValueOnce(new LedgerPersistError("db down"));
    const { syncBinance } = await import("../../web/src/lib/sync");
    const result = await syncBinance(null, { userId: "u1" });
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/Persist failed/i);
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
});
