import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { monadRpcFromClient } from "../../web/src/lib/sync";

const persistSourceSync = vi.fn();
const getSourceHighWaterMs = vi.fn();
const fetchMonadStakeEarnEvents = vi.fn();
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
    fetchMonadStakeEarnEvents: (...args: unknown[]) =>
      fetchMonadStakeEarnEvents(...args),
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

    fetchMonadStakeEarnEvents.mockResolvedValueOnce([]);
    const ok = await syncMonadStake(addr, { userId: "u1" });
    expect(ok.status).toBe("ok");
    expect(fetchMonadStakeEarnEvents).toHaveBeenCalled();

    fetchMonadStakeEarnEvents.mockRejectedValueOnce(new Error("rpc boom"));
    const err = await syncMonadStake(addr, { userId: "u1" });
    expect(err.status).toBe("error");
    expect(err.error).toMatch(/Monad staking rewards|rpc boom/i);
  });
});
