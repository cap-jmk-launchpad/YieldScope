import { describe, expect, it, vi } from "vitest";
import {
  CLAIM_REWARDS_TOPIC0,
  DEFAULT_MONAD_ARCHIVE_RPC_URL,
  FALLBACK_MONAD_ARCHIVE_RPC_URL,
  MonadClaimHistoryError,
  claimRewardsLogsToEarnEvents,
  createHttpJsonRpc,
  decodeClaimRewardsLog,
  envInt,
  fetchClaimRewardsViaArchiveRpc,
  fetchClaimRewardsViaExplorer,
  fetchClaimRewardsViaWideGetLogs,
  fetchMonadClaimedRewards,
  resolveArchiveRpcUrl,
  resolveClaimLogBlockRange,
  resolveExplorerConfig,
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
  it("defaults archive RPC to rpc1 (wide getLogs)", () => {
    expect(DEFAULT_MONAD_ARCHIVE_RPC_URL).toBe("https://rpc1.monad.xyz");
  });

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
    const fetchImpl = vi.fn();
    const full = Array.from({ length: 1000 }, (_, i) =>
      sampleClaimLog({ tx: `0x${(i + 1).toString(16).padStart(64, "0")}` }),
    );
    fetchImpl
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

  it("single-shot wide getLogs covers full chain with topic2", async () => {
    const rpc = vi.fn(async (method: string, params: unknown[]) => {
      if (method === "eth_blockNumber") return "0x3e8"; // 1000
      if (method === "eth_getLogs") {
        const filter = params[0] as {
          fromBlock: string;
          topics: (string | null)[];
        };
        expect(filter.fromBlock).toBe("0x0");
        expect(filter.topics[0]).toBe(CLAIM_REWARDS_TOPIC0);
        expect(filter.topics[1]).toBeNull();
        expect(filter.topics[2]).toBe(padAddressTopic(DELEGATOR));
        return [sampleClaimLog()];
      }
      throw new Error(`unexpected ${method}`);
    });
    const wide = await fetchClaimRewardsViaWideGetLogs(DELEGATOR, rpc);
    expect(wide.events).toHaveLength(1);
    expect(wide.fromBlock).toBe(0n);
  });

  it("prefers wide getLogs then falls back to chunks", async () => {
    let wideAttempts = 0;
    const rpc = vi.fn(async (method: string) => {
      if (method === "eth_blockNumber") return "0x3e8";
      if (method === "eth_getBlockByNumber") {
        return { timestamp: "0x65a00000" };
      }
      if (method === "eth_getLogs") {
        wideAttempts += 1;
        if (wideAttempts === 1) {
          throw new Error("Block range is too large");
        }
        return [sampleClaimLog()];
      }
      throw new Error(`unexpected ${method}`);
    });
    const result = await fetchClaimRewardsViaArchiveRpc(DELEGATOR, rpc, {
      fromBlock: 0n,
      toBlock: 1000n,
      chunkBlocks: 500,
      maxBlocks: 10_000,
      concurrency: 2,
    });
    expect(result.mode).toBe("chunked");
    expect(result.events.length).toBeGreaterThanOrEqual(1);
    expect(rpc).toHaveBeenCalled();

    const soft = await fetchMonadClaimedRewards(DELEGATOR, {
      preferArchive: true,
      jsonRpc: async () => {
        throw new Error("boom");
      },
    });
    expect(soft.source).toBe("none");
    expect(soft.events).toEqual([]);
    expect(soft.complete).toBe(false);
    expect(soft.info).toMatch(/pending unclaimed only/i);
  });

  it("marks wide archive history complete without explorer key", async () => {
    const rpc = vi.fn(async (method: string) => {
      if (method === "eth_blockNumber") return "0x1000";
      if (method === "eth_getLogs") return [sampleClaimLog()];
      throw new Error(`unexpected ${method}`);
    });
    const result = await fetchMonadClaimedRewards(DELEGATOR, {
      preferArchive: true,
      jsonRpc: rpc,
    });
    expect(result.source).toBe("archive_rpc");
    expect(result.complete).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.info).toMatch(/full ClaimRewards/i);
  });
  it("resolveExplorerConfig accepts ETHERSCAN_API_KEY as MONAD_EXPLORER alias", () => {
    const prevM = process.env.MONAD_EXPLORER_API_KEY;
    const prevE = process.env.ETHERSCAN_API_KEY;
    try {
      delete process.env.MONAD_EXPLORER_API_KEY;
      process.env.ETHERSCAN_API_KEY = "etherscan-alias-key";
      const cfg = resolveExplorerConfig();
      expect(cfg).not.toBeNull();
      expect(cfg?.apiKey).toBe("etherscan-alias-key");
      expect(cfg?.chainId).toBe(143);

      process.env.MONAD_EXPLORER_API_KEY = "monad-preferred-key";
      const preferred = resolveExplorerConfig();
      expect(preferred?.apiKey).toBe("monad-preferred-key");
    } finally {
      if (prevM === undefined) delete process.env.MONAD_EXPLORER_API_KEY;
      else process.env.MONAD_EXPLORER_API_KEY = prevM;
      if (prevE === undefined) delete process.env.ETHERSCAN_API_KEY;
      else process.env.ETHERSCAN_API_KEY = prevE;
    }
  });

  it("decodeClaimRewardsLog rejects malformed / removed / zero-amount logs", () => {
    expect(decodeClaimRewardsLog({ topics: [], data: "0x" })).toBeNull();
    expect(
      decodeClaimRewardsLog({
        topics: ["0xdead", "0x1", padAddressTopic(DELEGATOR)],
        data: "0x01",
      }),
    ).toBeNull();
    expect(decodeClaimRewardsLog({ ...sampleClaimLog(), removed: true })).toBeNull();
    expect(
      decodeClaimRewardsLog({
        ...sampleClaimLog(),
        topics: [CLAIM_REWARDS_TOPIC0, "0x10", "0x12"],
      }),
    ).toBeNull();
    expect(
      decodeClaimRewardsLog({ ...sampleClaimLog(), data: "0x" }),
    ).toBeNull();
    expect(
      decodeClaimRewardsLog(sampleClaimLog({ amountWei: 0n })),
    ).toBeNull();
    expect(new MonadClaimHistoryError("x").name).toBe("MonadClaimHistoryError");
  });

  it("claimRewardsLogsToEarnEvents covers filters, duplicates, and missing timestamps", () => {
    const noTs: RpcLog = {
      ...sampleClaimLog({ tx: "0xaaa" }),
      blockTimestamp: undefined,
    };
    const badTs: RpcLog = {
      ...sampleClaimLog({ tx: "0xbbb" }),
      blockTimestamp: "not-hex" as `0x${string}`,
    };
    const late = sampleClaimLog({ tx: "0xccc", ts: 2_000_000_000 });
    const zeroVal = sampleClaimLog({ tx: "0xddd", validatorId: 0n });
    const noTx = { ...sampleClaimLog(), transactionHash: undefined };
    const dup = sampleClaimLog({ tx: "0xaaa" });

    const events = claimRewardsLogsToEarnEvents(
      DELEGATOR,
      [noTs, badTs, late, zeroVal, noTx, dup, sampleClaimLog({ tx: "0xeee", ts: 1_700_000_000 })],
      { startMs: 1_600_000_000_000, endMs: 1_800_000_000_000 },
    );
    expect(events.some((e) => e.meta?.txHash === "0xaaa")).toBe(true);
    expect(events.some((e) => e.meta?.txHash === "0xbbb")).toBe(true);
    expect(events.some((e) => e.meta?.txHash === "0xccc")).toBe(false);
    expect(events.some((e) => e.meta?.txHash === "0xddd")).toBe(false);
    expect(events.filter((e) => e.meta?.txHash === "0xaaa")).toHaveLength(1);
  });

  it("envInt / resolveArchiveRpcUrl / resolveExplorerConfig edges", () => {
    const prev = {
      bad: process.env.MONAD_CLAIM_HISTORY_MAX_BLOCKS,
      archive: process.env.MONAD_ARCHIVE_RPC_URL,
      explorer: process.env.MONAD_EXPLORER_API_KEY,
      etherscan: process.env.ETHERSCAN_API_KEY,
      url: process.env.MONAD_EXPLORER_API_URL,
      chain: process.env.MONAD_EXPLORER_CHAIN_ID,
    };
    try {
      delete process.env.MONAD_CLAIM_HISTORY_MAX_BLOCKS;
      expect(envInt("MONAD_CLAIM_HISTORY_MAX_BLOCKS", 42)).toBe(42);
      process.env.MONAD_CLAIM_HISTORY_MAX_BLOCKS = "not-a-number";
      expect(envInt("MONAD_CLAIM_HISTORY_MAX_BLOCKS", 42)).toBe(42);
      process.env.MONAD_CLAIM_HISTORY_MAX_BLOCKS = "99";
      expect(envInt("MONAD_CLAIM_HISTORY_MAX_BLOCKS", 42)).toBe(99);

      delete process.env.MONAD_ARCHIVE_RPC_URL;
      expect(resolveArchiveRpcUrl()).toBe(DEFAULT_MONAD_ARCHIVE_RPC_URL);
      expect(resolveArchiveRpcUrl(" https://custom.rpc ")).toBe("https://custom.rpc");
      process.env.MONAD_ARCHIVE_RPC_URL = "https://env.rpc";
      expect(resolveArchiveRpcUrl()).toBe("https://env.rpc");

      delete process.env.MONAD_EXPLORER_API_KEY;
      delete process.env.ETHERSCAN_API_KEY;
      expect(resolveExplorerConfig()).toBeNull();
      expect(
        resolveExplorerConfig({
          apiKey: "k",
          apiUrl: "https://custom.explorer/api",
          chainId: 999,
        }),
      ).toEqual({
        apiKey: "k",
        apiUrl: "https://custom.explorer/api",
        chainId: 999,
      });
      process.env.MONAD_EXPLORER_API_URL = "https://env.explorer/api";
      process.env.MONAD_EXPLORER_CHAIN_ID = "200";
      expect(resolveExplorerConfig({ apiKey: "k" })?.apiUrl).toBe(
        "https://env.explorer/api",
      );
      expect(resolveExplorerConfig({ apiKey: "k" })?.chainId).toBe(200);
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        const envKey = (
          {
            bad: "MONAD_CLAIM_HISTORY_MAX_BLOCKS",
            archive: "MONAD_ARCHIVE_RPC_URL",
            explorer: "MONAD_EXPLORER_API_KEY",
            etherscan: "ETHERSCAN_API_KEY",
            url: "MONAD_EXPLORER_API_URL",
            chain: "MONAD_EXPLORER_CHAIN_ID",
          } as const
        )[k as keyof typeof prev];
        if (v === undefined) delete process.env[envKey];
        else process.env[envKey] = v;
      }
    }
  });

  it("createHttpJsonRpc surfaces HTTP and RPC errors", async () => {
    const ok = createHttpJsonRpc("https://rpc.example", (async () => ({
      ok: true,
      json: async () => ({ result: "0x1" }),
    })) as unknown as typeof fetch);
    await expect(ok("eth_blockNumber", [])).resolves.toBe("0x1");

    const httpFail = createHttpJsonRpc("https://rpc.example", (async () => ({
      ok: false,
      status: 503,
    })) as unknown as typeof fetch);
    await expect(httpFail("eth_blockNumber", [])).rejects.toThrow(/HTTP 503/);

    const rpcFail = createHttpJsonRpc("https://rpc.example", (async () => ({
      ok: true,
      json: async () => ({ error: { message: "too wide" } }),
    })) as unknown as typeof fetch);
    await expect(rpcFail("eth_getLogs", [])).rejects.toThrow(/too wide/);
  });

  it("resolveClaimLogBlockRange covers startMs, uncapped, and maxBlocks clamp", async () => {
    const rpc = vi.fn(async (method: string) => {
      if (method === "eth_blockNumber") return "0x2710"; // 10000
      if (method === "eth_getBlockByNumber") {
        return { timestamp: "0x65a00000" };
      }
      throw new Error(method);
    });

    const withStart = await resolveClaimLogBlockRange(rpc, {
      startMs: Date.parse("2024-01-01T00:00:00.000Z"),
      maxBlocks: 500,
    });
    expect(withStart.fromBlock).toBeGreaterThanOrEqual(0n);
    expect(withStart.toBlock).toBe(10000n);

    const missingTs = vi.fn(async (method: string) => {
      if (method === "eth_blockNumber") return "0x64";
      if (method === "eth_getBlockByNumber") return {};
      throw new Error(method);
    });
    const fallbackTs = await resolveClaimLogBlockRange(missingTs, {
      startMs: Date.now() - 400_000,
      maxBlocks: 10_000,
    });
    expect(fallbackTs.toBlock).toBe(100n);

    const uncapped = await resolveClaimLogBlockRange(rpc, { uncapped: true });
    expect(uncapped.fromBlock).toBe(0n);
    expect(uncapped.capped).toBe(false);

    const capped = await resolveClaimLogBlockRange(rpc, { maxBlocks: 100 });
    expect(capped.capped).toBe(true);
    expect(capped.fromBlock).toBe(9900n);

    const clamped = await resolveClaimLogBlockRange(rpc, {
      fromBlock: 0n,
      maxBlocks: 50,
    });
    expect(clamped.fromBlock).toBe(9950n);
    expect(clamped.capped).toBe(true);

    const toLatest = await resolveClaimLogBlockRange(rpc, {
      fromBlock: 1n,
      toBlock: 99999n,
    });
    expect(toLatest.toBlock).toBe(10000n);
  });

  it("wide getLogs returns empty when range inverted; non-array logs become []", async () => {
    const rpc = vi.fn(async (method: string) => {
      if (method === "eth_blockNumber") return "0x10";
      if (method === "eth_getLogs") return null;
      throw new Error(method);
    });
    const empty = await fetchClaimRewardsViaWideGetLogs(DELEGATOR, rpc, {
      fromBlock: 100n,
      toBlock: 10n,
    });
    expect(empty.events).toEqual([]);

    const nullLogs = await fetchClaimRewardsViaWideGetLogs(DELEGATOR, rpc, {
      fromBlock: 0n,
      toBlock: 10n,
    });
    expect(nullLogs.events).toEqual([]);
  });

  it("chunked archive covers preferWide=false, partial failures, and all-fail", async () => {
    const rpc = vi.fn(async (method: string, params: unknown[]) => {
      if (method === "eth_blockNumber") return "0x3e8";
      if (method === "eth_getLogs") {
        const filter = params[0] as { fromBlock: string };
        if (filter.fromBlock === "0x0") return [sampleClaimLog()];
        throw new Error("chunk fail");
      }
      throw new Error(method);
    });
    const partial = await fetchClaimRewardsViaArchiveRpc(DELEGATOR, rpc, {
      preferWide: false,
      fromBlock: 0n,
      toBlock: 1000n,
      chunkBlocks: 500,
      concurrency: 2,
    });
    expect(partial.mode).toBe("chunked");
    expect(partial.events.length).toBeGreaterThanOrEqual(1);
    expect(partial.complete).toBe(false);

    const allFail = vi.fn(async (method: string) => {
      if (method === "eth_blockNumber") return "0x64";
      if (method === "eth_getLogs") throw new Error("down");
      throw new Error(method);
    });
    await expect(
      fetchClaimRewardsViaArchiveRpc(DELEGATOR, allFail, {
        preferWide: false,
        fromBlock: 0n,
        toBlock: 100n,
        chunkBlocks: 50,
        concurrency: 1,
      }),
    ).rejects.toThrow(/All chunked eth_getLogs/);

    const inverted = vi.fn(async (method: string) => {
      if (method === "eth_blockNumber") return "0x10";
      throw new Error(method);
    });
    const empty = await fetchClaimRewardsViaArchiveRpc(DELEGATOR, inverted, {
      preferWide: false,
      fromBlock: 50n,
      toBlock: 10n,
    });
    expect(empty.events).toEqual([]);
  });

  it("explorer soft-fails: HTTP error, no records, and non-string status0", async () => {
    await expect(
      fetchClaimRewardsViaExplorer(DELEGATOR, {
        apiUrl: "https://api.etherscan.io/v2/api",
        apiKey: "k",
        chainId: 143,
        toBlock: 1000,
        fetchImpl: (async () => ({
          ok: false,
          status: 429,
        })) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/HTTP 429/);

    const noRecords = await fetchClaimRewardsViaExplorer(DELEGATOR, {
      apiUrl: "https://api.etherscan.io/v2/api",
      apiKey: "k",
      chainId: 143,
      fetchImpl: (async () => ({
        ok: true,
        json: async () => ({
          status: "0",
          result: "No records found",
        }),
      })) as unknown as typeof fetch,
    });
    expect(noRecords).toEqual([]);

    await expect(
      fetchClaimRewardsViaExplorer(DELEGATOR, {
        apiUrl: "https://api.etherscan.io/v2/api",
        apiKey: "k",
        chainId: 143,
        fetchImpl: (async () => ({
          ok: true,
          json: async () => ({
            status: "0",
            message: "NOTOK",
            result: "Max rate limit reached",
          }),
        })) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/Max rate limit/);

    await expect(
      fetchClaimRewardsViaExplorer(DELEGATOR, {
        apiUrl: "https://api.etherscan.io/v2/api",
        apiKey: "k",
        chainId: 143,
        fetchImpl: (async () => ({
          ok: true,
          json: async () => ({
            status: "0",
            message: "fallback-msg",
            result: [{ topics: [] }],
          }),
        })) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/fallback-msg/);
  });

  it("fetchMonadClaimedRewards prefers explorer then soft-degrades notes", async () => {
    const prevM = process.env.MONAD_EXPLORER_API_KEY;
    const prevE = process.env.ETHERSCAN_API_KEY;
    try {
      process.env.MONAD_EXPLORER_API_KEY = "test-key";
      delete process.env.ETHERSCAN_API_KEY;

      const explorerOk = await fetchMonadClaimedRewards(DELEGATOR, {
        fetchImpl: (async () => ({
          ok: true,
          json: async () => ({
            status: "1",
            result: [sampleClaimLog()],
          }),
        })) as unknown as typeof fetch,
      });
      expect(explorerOk.source).toBe("explorer");
      expect(explorerOk.complete).toBe(true);
      expect(explorerOk.events).toHaveLength(1);

      const explorerFailThenArchive = await fetchMonadClaimedRewards(DELEGATOR, {
        fetchImpl: (async () => ({
          ok: false,
          status: 500,
        })) as unknown as typeof fetch,
        jsonRpc: async (method: string) => {
          if (method === "eth_blockNumber") return "0x100";
          if (method === "eth_getLogs") return [sampleClaimLog()];
          throw new Error(method);
        },
      });
      expect(explorerFailThenArchive.source).toBe("archive_rpc");
      expect(explorerFailThenArchive.info).toMatch(/Explorer claim history unavailable/);
      expect(explorerFailThenArchive.info).toMatch(/full ClaimRewards|sync window/i);

      let getLogsCalls = 0;
      const chunked = await fetchMonadClaimedRewards(DELEGATOR, {
        preferArchive: true,
        jsonRpc: async (method: string) => {
          if (method === "eth_blockNumber") return "0x64"; // 100
          if (method === "eth_getLogs") {
            getLogsCalls += 1;
            // First call is wide single-shot; subsequent are chunked fallback.
            if (getLogsCalls === 1) {
              throw new Error("Block range is too large");
            }
            return [sampleClaimLog()];
          }
          throw new Error(method);
        },
      });
      expect(chunked.source).toBe("archive_rpc");
      expect(getLogsCalls).toBeGreaterThan(1);
      expect(chunked.info).toMatch(/chunked archive RPC/i);

      const windowed = await fetchMonadClaimedRewards(DELEGATOR, {
        preferArchive: true,
        startMs: Date.parse("2024-06-01T00:00:00.000Z"),
        jsonRpc: async (method: string) => {
          if (method === "eth_blockNumber") return "0x1000";
          if (method === "eth_getBlockByNumber") {
            return { timestamp: "0x65a00000" };
          }
          if (method === "eth_getLogs") return [sampleClaimLog()];
          throw new Error(method);
        },
      });
      expect(windowed.source).toBe("archive_rpc");
      expect(windowed.info).toMatch(/sync window/i);

      const softNonError = await fetchMonadClaimedRewards(DELEGATOR, {
        preferArchive: true,
        jsonRpc: async () => {
          throw "string-boom";
        },
      });
      expect(softNonError.source).toBe("none");
      expect(softNonError.info).toMatch(/archive RPC failed|pending unclaimed/i);
    } finally {
      if (prevM === undefined) delete process.env.MONAD_EXPLORER_API_KEY;
      else process.env.MONAD_EXPLORER_API_KEY = prevM;
      if (prevE === undefined) delete process.env.ETHERSCAN_API_KEY;
      else process.env.ETHERSCAN_API_KEY = prevE;
    }
  });

  it("fetchMonadClaimedRewards tries fallback archive URL without injected rpc", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      return {
        ok: true,
        json: async () => ({
          error: { message: `fail ${url}` },
        }),
      };
    }) as unknown as typeof fetch;

    const result = await fetchMonadClaimedRewards(DELEGATOR, {
      preferArchive: true,
      fetchImpl,
    });
    expect(result.source).toBe("none");
    expect(urls.some((u) => u.includes("rpc1.monad.xyz"))).toBe(true);
    expect(urls.some((u) => u.includes("rpc3.monad.xyz"))).toBe(true);
    expect(FALLBACK_MONAD_ARCHIVE_RPC_URL).toContain("rpc3");
  });

  it("covers logSortKey defaults, negative fromBlock, and explorer edge bodies", async () => {
    const sparse: RpcLog = {
      topics: sampleClaimLog().topics,
      data: sampleClaimLog().data,
      // omit blockNumber / logIndex / transactionHash for sort-key defaults
    };
    const withTx: RpcLog = {
      ...sampleClaimLog({ tx: "0xabc" }),
      logIndex: undefined,
    };
    // Sparse log has no tx → filtered; withTx maps with default logIndex.
    const mapped = claimRewardsLogsToEarnEvents(DELEGATOR, [sparse, withTx]);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]!.id).toContain(":0x0");

    // Force chunked path to sort sparse logs (exercises logSortKey ?? defaults).
    const sortRpc = vi.fn(async (method: string) => {
      if (method === "eth_blockNumber") return "0x2";
      if (method === "eth_getLogs") {
        return [
          { topics: sampleClaimLog().topics, data: sampleClaimLog().data },
          sampleClaimLog({ tx: "0x111" }),
        ];
      }
      throw new Error(method);
    });
    const sorted = await fetchClaimRewardsViaArchiveRpc(DELEGATOR, sortRpc, {
      preferWide: false,
      fromBlock: 0n,
      toBlock: 2n,
      chunkBlocks: 10,
    });
    expect(sorted.mode).toBe("chunked");

    const negRpc = vi.fn(async (method: string) => {
      if (method === "eth_blockNumber") return "0x64";
      throw new Error(method);
    });
    const neg = await resolveClaimLogBlockRange(negRpc, {
      fromBlock: -5n as bigint,
      toBlock: 10n,
    });
    expect(neg.fromBlock).toBe(0n);

    const nonArrayChunk = vi.fn(async (method: string) => {
      if (method === "eth_blockNumber") return "0x10";
      if (method === "eth_getLogs") return { not: "array" };
      throw new Error(method);
    });
    const coerced = await fetchClaimRewardsViaArchiveRpc(DELEGATOR, nonArrayChunk, {
      preferWide: false,
      fromBlock: 0n,
      toBlock: 10n,
      chunkBlocks: 10,
    });
    expect(coerced.events).toEqual([]);

    await expect(
      fetchClaimRewardsViaExplorer(DELEGATOR, {
        apiUrl: "https://api.etherscan.io/v2/api",
        apiKey: "k",
        chainId: 143,
        fetchImpl: (async () => ({
          ok: true,
          json: async () => ({
            status: "0",
            result: [{ topics: [] }],
          }),
        })) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/Monad explorer getLogs failed/);

    const nonArrayOk = await fetchClaimRewardsViaExplorer(DELEGATOR, {
      apiUrl: "https://api.etherscan.io/v2/api",
      apiKey: "k",
      chainId: 143,
      fetchImpl: (async () => ({
        ok: true,
        json: async () => ({
          status: "1",
          result: "not-an-array",
        }),
      })) as unknown as typeof fetch,
    });
    expect(nonArrayOk).toEqual([]);

    const prevFetch = globalThis.fetch;
    try {
      globalThis.fetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({ result: "0x1" }),
      })) as unknown as typeof fetch;
      const rpc = createHttpJsonRpc("https://rpc.example");
      await expect(rpc("eth_blockNumber", [])).resolves.toBe("0x1");

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("etherscan") || url.includes("api")) {
          return {
            ok: true,
            json: async () => ({
              status: "1",
              result: [sampleClaimLog()],
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({ result: "0x64" }),
        };
      }) as unknown as typeof fetch;

      // Explorer success via default fetchImpl (no opts.fetchImpl).
      const viaDefaultFetch = await fetchClaimRewardsViaExplorer(DELEGATOR, {
        apiUrl: "https://api.etherscan.io/v2/api",
        apiKey: "k",
        chainId: 143,
      });
      expect(viaDefaultFetch).toHaveLength(1);
    } finally {
      globalThis.fetch = prevFetch;
    }

    const prevKey = process.env.MONAD_EXPLORER_API_KEY;
    try {
      process.env.MONAD_EXPLORER_API_KEY = "k";
      const nonErrorExplorer = await fetchMonadClaimedRewards(DELEGATOR, {
        fetchImpl: (async () => {
          throw "explorer-string-fail";
        }) as unknown as typeof fetch,
        jsonRpc: async (method: string) => {
          if (method === "eth_blockNumber") return "0x10";
          if (method === "eth_getLogs") return [];
          throw new Error(method);
        },
      });
      expect(nonErrorExplorer.info).toMatch(
        /Explorer claim history unavailable\./,
      );
      expect(nonErrorExplorer.source).toBe("archive_rpc");
    } finally {
      if (prevKey === undefined) delete process.env.MONAD_EXPLORER_API_KEY;
      else process.env.MONAD_EXPLORER_API_KEY = prevKey;
    }

    // tryArchiveClaimHistory default fetchImpl (no opts.fetchImpl / jsonRpc).
    const prevFetch2 = globalThis.fetch;
    try {
      globalThis.fetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({ error: { message: "rpc down" } }),
      })) as unknown as typeof fetch;
      const soft = await fetchMonadClaimedRewards(DELEGATOR, {
        preferArchive: true,
        archiveRpcUrl: "https://only-one.rpc",
      });
      expect(soft.source).toBe("none");
      expect(soft.info).toMatch(/rpc down/);
    } finally {
      globalThis.fetch = prevFetch2;
    }
  });
});
