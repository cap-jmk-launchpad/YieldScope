import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { monadRpcFromClient } from "../../web/src/lib/sync";

const persistSourceSync = vi.fn();
const getSourceHighWaterMs = vi.fn();
const scanMonadStake = vi.fn();
const call = vi.fn();

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

vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");
  return {
    ...actual,
    createPublicClient: () => ({ call }),
    http: () => ({}),
  };
});

vi.mock("../../web/src/lib/adapters/monad-stake", async () => {
  const actual = await vi.importActual<
    typeof import("../../web/src/lib/adapters/monad-stake")
  >("../../web/src/lib/adapters/monad-stake");
  return {
    ...actual,
    scanMonadStake: (...args: unknown[]) => scanMonadStake(...args),
  };
});

describe("monadRpcFromClient", () => {
  it("returns call data and rejects empty results", async () => {
    const localCall = vi
      .fn()
      .mockResolvedValueOnce({ data: undefined })
      .mockResolvedValueOnce({ data: "0x01" });
    const rpc = monadRpcFromClient({ call: localCall });

    await expect(
      rpc({
        to: "0x0000000000000000000000000000000000001000",
        data: "0x",
      }),
    ).rejects.toThrow(/Empty eth_call/);

    await expect(
      rpc({
        to: "0x0000000000000000000000000000000000001000",
        data: "0x",
      }),
    ).resolves.toBe("0x01");
  });
});

describe("syncMonadStake live path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.USE_FIXTURE_DEMO = "0";
    delete process.env.MONAD_RPC_URL;
    persistSourceSync.mockResolvedValue({ profileId: "p1", eventCount: 0 });
    getSourceHighWaterMs.mockResolvedValue(null);
    call.mockResolvedValue({ data: "0x01" });
  });

  afterEach(() => {
    delete process.env.USE_FIXTURE_DEMO;
  });

  it("live success and live adapter error", async () => {
    const { syncMonadStake } = await import("../../web/src/lib/sync");
    const addr = "0x0000000000000000000000000000000000000001" as const;

    scanMonadStake.mockResolvedValueOnce({
      events: [],
      pendingEvents: [],
      info: "No Monad stake found",
      states: [],
      claimHistorySource: "archive_rpc",
      claimHistoryComplete: true,
      claimHistoryOk: true,
    });
    const ok = await syncMonadStake(addr, { userId: "u1" });
    expect(ok.status).toBe("ok");
    expect(ok.info).toMatch(/No Monad stake/);
    expect(scanMonadStake).toHaveBeenCalled();
    expect(persistSourceSync).toHaveBeenCalledWith(
      expect.objectContaining({ info: expect.stringMatching(/No Monad stake/) }),
    );

    scanMonadStake.mockRejectedValueOnce(new Error("rpc boom"));
    const err = await syncMonadStake(addr, { userId: "u1" });
    expect(err.status).toBe("error");
    expect(err.error).toMatch(/Monad staking rewards|rpc boom/i);
  });

  it("explorer / complete history uses full persist plan", async () => {
    const { syncMonadStake } = await import("../../web/src/lib/sync");
    const addr = "0x0000000000000000000000000000000000000001" as const;
    const claimed = {
      id: "monad_stake:x:claim:0xabc:0x0",
      source: "monad_stake" as const,
      asset: "MON",
      amount: "1",
      earnedAt: "2024-06-01T00:00:00.000Z",
      rawType: "CLAIMED_STAKING_REWARDS",
    };

    scanMonadStake.mockResolvedValueOnce({
      events: [claimed],
      pendingEvents: [],
      states: [],
      claimHistorySource: "explorer",
      claimHistoryComplete: true,
      claimHistoryOk: true,
      info: "from explorer",
    });
    const explorer = await syncMonadStake(addr, { userId: "u1" });
    expect(explorer.status).toBe("ok");
    expect(explorer.events).toHaveLength(1);
    expect(persistSourceSync).toHaveBeenCalledWith(
      expect.objectContaining({ persistMode: "replace" }),
    );
  });

  it("incomplete archive soft-upserts; none keeps pending only", async () => {
    const { syncMonadStake } = await import("../../web/src/lib/sync");
    const addr = "0x0000000000000000000000000000000000000001" as const;
    const pending = {
      id: "monad_stake:x:pending:1",
      source: "monad_stake" as const,
      asset: "MON",
      amount: "2.5",
      earnedAt: "2024-07-01T00:00:00.000Z",
      rawType: "PENDING_STAKING_REWARDS",
    };
    const claimed = {
      id: "monad_stake:x:claim:0xdef:0x0",
      source: "monad_stake" as const,
      asset: "MON",
      amount: "1",
      earnedAt: "2024-06-01T00:00:00.000Z",
      rawType: "CLAIMED_STAKING_REWARDS",
    };

    getSourceHighWaterMs.mockResolvedValueOnce(Date.parse("2024-06-15T00:00:00.000Z"));
    scanMonadStake.mockResolvedValueOnce({
      events: [claimed, pending],
      pendingEvents: [pending],
      states: [],
      claimHistorySource: "archive_rpc",
      claimHistoryComplete: false,
      claimHistoryOk: true,
      info: "partial chunked",
    });
    const soft = await syncMonadStake(addr, { userId: "u1" });
    expect(soft.status).toBe("ok");
    expect(persistSourceSync).toHaveBeenCalledWith(
      expect.objectContaining({ persistMode: "upsert" }),
    );

    scanMonadStake.mockResolvedValueOnce({
      events: [claimed, pending],
      pendingEvents: [pending],
      states: [],
      claimHistorySource: "none",
      claimHistoryComplete: false,
      claimHistoryOk: false,
      info: "history unavailable",
    });
    const none = await syncMonadStake(addr, {
      userId: "u1",
      window: {
        mode: "custom",
        fromMs: Date.parse("2024-01-01T00:00:00.000Z"),
        toMs: Date.parse("2024-12-31T23:59:59.999Z"),
      },
    });
    expect(none.status).toBe("ok");
    expect(none.events).toEqual([pending]);
  });

  it("incremental plan passes endMs into scanMonadStake", async () => {
    const { syncMonadStake } = await import("../../web/src/lib/sync");
    const addr = "0x0000000000000000000000000000000000000001" as const;
    const highWater = Date.now() - 86_400_000;
    getSourceHighWaterMs.mockResolvedValueOnce(highWater);
    scanMonadStake.mockResolvedValueOnce({
      events: [],
      pendingEvents: [],
      states: [],
      claimHistorySource: "archive_rpc",
      claimHistoryComplete: true,
      claimHistoryOk: true,
    });
    await syncMonadStake(addr, { userId: "u1" });
    expect(scanMonadStake).toHaveBeenCalledWith(
      addr,
      expect.any(Function),
      expect.objectContaining({
        startMs: expect.any(Number),
        endMs: expect.any(Number),
      }),
    );
  });
});
