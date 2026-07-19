import { describe, expect, it, vi } from "vitest";
import {
  CLAIM_REWARDS_TOPIC0,
  claimRewardsLogsToEarnEvents,
  decodeClaimRewardsLog,
  fetchClaimRewardsViaArchiveRpc,
  fetchClaimRewardsViaExplorer,
  fetchMonadClaimedRewards,
  padAddressTopic,
  type RpcLog,
} from "../../web/src/lib/adapters/monad-claim-history";

const DELEGATOR = "0x4024BdfeEDfd1CAe7d2d02250e33dBf0B3ac109f" as const;
const OTHER = "0x1111111111111111111111111111111111111111" as const;

function sampleClaimLog(opts?: {
  delegator?: string;
  amountWei?: bigint;
  validatorId?: bigint;
  tx?: string;
  ts?: number;
}): RpcLog {
  const validatorId = opts?.validatorId ?? 16n;
  const amount = opts?.amountWei ?? 25000000000000000000n; // 25 MON
  const epoch = 1776n;
  const amountHex = amount.toString(16).padStart(64, "0");
  const epochHex = epoch.toString(16).padStart(64, "0");
  const delegator = (opts?.delegator ?? DELEGATOR).toLowerCase();
  return {
    address: "0x0000000000000000000000000000000000001000",
    topics: [
      CLAIM_REWARDS_TOPIC0,
      `0x${validatorId.toString(16).padStart(64, "0")}`,
      padAddressTopic(delegator as `0x${string}`),
    ],
    data: `0x${amountHex}${epochHex}`,
    blockNumber: "0x54a97fd",
    blockTimestamp: `0x${(opts?.ts ?? 1_700_000_000).toString(16)}`,
    transactionHash: (opts?.tx ??
      "0xde3f4e318488046b5f5985b16b43c169ac955120439ca8300206415e4dd001b2") as `0x${string}`,
    logIndex: "0xb8",
    removed: false,
  };
}

describe("Monad ClaimRewards history", () => {
  it("decodes ClaimRewards log topics + data", () => {
    const decoded = decodeClaimRewardsLog(sampleClaimLog());
    expect(decoded).not.toBeNull();
    expect(decoded!.validatorId).toBe(16n);
    expect(decoded!.delegator.toLowerCase()).toBe(DELEGATOR.toLowerCase());
    expect(decoded!.amount).toBe(25000000000000000000n);
    expect(decoded!.epoch).toBe(1776n);
  });

  it("maps logs to earn events and filters other delegators", () => {
    const events = claimRewardsLogsToEarnEvents(DELEGATOR, [
      sampleClaimLog(),
      sampleClaimLog({ delegator: OTHER, tx: "0xbbb" }),
      sampleClaimLog({ amountWei: 0n, tx: "0xccc" }),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]!.amount).toBe("25");
    expect(events[0]!.rawType).toBe("CLAIMED_STAKING_REWARDS");
    expect(events[0]!.meta?.validatorId).toBe("16");
    expect(events[0]!.id).toContain(":claim:");
  });

  it("respects time window when blockTimestamp is present", () => {
    const events = claimRewardsLogsToEarnEvents(
      DELEGATOR,
      [sampleClaimLog({ ts: 1_700_000_000 })],
      {
        startMs: 1_800_000_000_000,
        endMs: 1_900_000_000_000,
      },
    );
    expect(events).toEqual([]);
  });

  it("fetches via explorer with topic2 filter and paginates", async () => {
    const page1 = {
      status: "1",
      result: [sampleClaimLog({ tx: "0xaaa" })],
    };
    const page2 = { status: "1", result: [] };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => page1,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => page2,
      });
    // First page has 1 < offset 1000 so no second page — force full page
    const full = Array.from({ length: 1000 }, (_, i) =>
      sampleClaimLog({ tx: `0x${(i + 1).toString(16).padStart(64, "0")}` }),
    );
    fetchImpl
      .mockReset()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "1", result: full }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "1",
          result: [sampleClaimLog({ tx: "0xeee" })],
        }),
      });

    const events = await fetchClaimRewardsViaExplorer(DELEGATOR, {
      apiUrl: "https://api.etherscan.io/v2/api",
      apiKey: "test-key",
      chainId: 143,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(events.length).toBe(1001);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const firstUrl = String(fetchImpl.mock.calls[0]![0]);
    expect(firstUrl).toContain("topic0=");
    expect(firstUrl).toContain("topic2=");
    expect(firstUrl).toContain("chainid=143");
  });

  it("chunks archive eth_getLogs and soft-degrades on total failure", async () => {
    const rpc = vi.fn(async (method: string) => {
      if (method === "eth_blockNumber") return "0x3e8"; // 1000
      if (method === "eth_getBlockByNumber") {
        return { timestamp: "0x65a00000" };
      }
      if (method === "eth_getLogs") return [sampleClaimLog()];
      throw new Error(`unexpected ${method}`);
    });
    const events = await fetchClaimRewardsViaArchiveRpc(DELEGATOR, rpc, {
      fromBlock: 0n,
      toBlock: 1000n,
      chunkBlocks: 500,
      maxBlocks: 10_000,
      concurrency: 2,
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(rpc).toHaveBeenCalled();

    const soft = await fetchMonadClaimedRewards(DELEGATOR, {
      preferArchive: true,
      jsonRpc: async () => {
        throw new Error("boom");
      },
    });
    expect(soft.source).toBe("none");
    expect(soft.events).toEqual([]);
    expect(soft.info).toMatch(/pending unclaimed only/i);
  });
});
