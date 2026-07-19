import {
  type Address,
  type Hex,
  decodeAbiParameters,
  hexToBigInt,
  isAddress,
  pad,
  toHex,
} from "viem";
import { formatBaseUnits } from "../decimal-amount";
import type { EarnEvent } from "./types";

/** Staking precompile — duplicated to avoid a circular import with monad-stake. */
const MONAD_STAKING_PRECOMPILE =
  "0x0000000000000000000000000000000000001000" as const;

/**
 * ClaimRewards(uint64 indexed validatorId, address indexed delegator, uint256 amount, uint64 epoch)
 * keccak256 of the canonical signature — verified against mainnet logs.
 * Emitted by claimRewards() and compound() (compound reuses the same event).
 */
export const CLAIM_REWARDS_TOPIC0 =
  "0xcb607e6b63c89c95f6ae24ece9fe0e38a7971aa5ed956254f1df47490921727b" as const;

/**
 * Public Monad RPC that accepts wide eth_getLogs when topic2 (delegator) is set.
 * Verified: fromBlock 0 → latest with ClaimRewards + wallet topic returns in <1s.
 * Do NOT use rpc.monad.xyz here (~100-block getLogs cap).
 */
export const DEFAULT_MONAD_ARCHIVE_RPC_URL = "https://rpc1.monad.xyz";

/** Narrower public RPC used only if the primary rejects wide getLogs. */
export const FALLBACK_MONAD_ARCHIVE_RPC_URL = "https://rpc3.monad.xyz";

/** Etherscan API V2 multichain base (Monad chainid 143 is free-tier). */
export const DEFAULT_MONAD_EXPLORER_API_URL = "https://api.etherscan.io/v2/api";

export const DEFAULT_MONAD_EXPLORER_CHAIN_ID = 143;

/** Chunk size for narrow RPCs that reject wide ranges (rpc3 ≈ 1000). */
export const DEFAULT_CLAIM_LOGS_CHUNK_BLOCKS = 1000;

/**
 * Safety cap for chunked walks when single-shot wide getLogs is unavailable.
 * ~6.5M blocks ≈ 30 days at 400ms — incremental catch-up; prefer rpc1 single-shot
 * for full history (no key, no self-hosted node).
 */
export const DEFAULT_CLAIM_HISTORY_MAX_BLOCKS = 6_480_000;

/** Parallel archive getLogs workers (chunked fallback). */
export const DEFAULT_CLAIM_LOGS_CONCURRENCY = 12;

/** Monad mainnet block time for ms → block estimates. */
export const MONAD_BLOCK_TIME_MS = 400;

export type ClaimHistorySource = "explorer" | "archive_rpc" | "none";

export interface ClaimHistoryResult {
  events: EarnEvent[];
  source: ClaimHistorySource;
  /** Soft note when history is partial / unavailable (never an error). */
  info?: string;
  /**
   * True when claimed history covers the requested window (genesis→now or
   * startMs→now). Explorer + rpc1 single-shot → true; capped chunk walk → false.
   */
  complete?: boolean;
}

export interface RpcLog {
  address?: string;
  topics: Hex[];
  data: Hex;
  blockNumber?: Hex | string;
  blockTimestamp?: Hex | string;
  transactionHash?: Hex | string;
  logIndex?: Hex | string;
  removed?: boolean;
}

export interface JsonRpcTransport {
  (method: string, params: unknown[]): Promise<unknown>;
}

export class MonadClaimHistoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MonadClaimHistoryError";
  }
}

export function padAddressTopic(address: Address): Hex {
  return pad(address.toLowerCase() as Address, { size: 32 });
}

export function decodeClaimRewardsLog(log: RpcLog): {
  validatorId: bigint;
  delegator: Address;
  amount: bigint;
  epoch: bigint;
} | null {
  if (!log?.topics || log.topics.length < 3) return null;
  if (log.topics[0]?.toLowerCase() !== CLAIM_REWARDS_TOPIC0) return null;
  if (log.removed) return null;

  const validatorId = hexToBigInt(log.topics[1]!);
  const delegatorWord = log.topics[2]!;
  const delegator = `0x${delegatorWord.slice(-40)}` as Address;
  if (!isAddress(delegator)) return null;

  if (!log.data || log.data === "0x") return null;
  const [amount, epoch] = decodeAbiParameters(
    [{ type: "uint256" }, { type: "uint64" }],
    log.data,
  );
  if (amount <= 0n) return null;
  return { validatorId, delegator, amount, epoch };
}

function logTimestampMs(log: RpcLog): number | null {
  if (log.blockTimestamp) {
    try {
      const sec = hexToBigInt(log.blockTimestamp as Hex);
      return Number(sec) * 1000;
    } catch {
      /* fall through */
    }
  }
  return null;
}

function logSortKey(log: RpcLog): string {
  const block = log.blockNumber ?? "0x0";
  const idx = log.logIndex ?? "0x0";
  const tx = log.transactionHash ?? "0x";
  return `${block}:${idx}:${tx}`;
}

/**
 * Map ClaimRewards logs → earn rows.
 * Product rule: topic2 is the claiming delegator — only that wallet’s claims.
 */
export function claimRewardsLogsToEarnEvents(
  expectedDelegator: Address,
  logs: RpcLog[],
  opts?: { startMs?: number | null; endMs?: number | null },
): EarnEvent[] {
  const want = expectedDelegator.toLowerCase();
  const startMs = opts?.startMs ?? null;
  const endMs = opts?.endMs ?? null;
  const out: EarnEvent[] = [];
  const seen = new Set<string>();

  for (const log of logs) {
    const decoded = decodeClaimRewardsLog(log);
    if (!decoded) continue;
    if (decoded.delegator.toLowerCase() !== want) continue;
    if (decoded.validatorId <= 0n) continue;

    const tx = (log.transactionHash ?? "").toLowerCase();
    if (!tx || tx === "0x") continue;
    const logIndex = log.logIndex ?? "0x0";
    const id = `monad_stake:${want}:claim:${tx}:${logIndex}`;
    if (seen.has(id)) continue;

    let earnedAt: string;
    const ms = logTimestampMs(log);
    if (ms != null && Number.isFinite(ms)) {
      if (startMs != null && ms < startMs) continue;
      if (endMs != null && ms > endMs) continue;
      earnedAt = new Date(ms).toISOString();
    } else {
      // Explorer / some RPCs omit timestamp — keep the row; sync window
      // filter may drop it later if bounds are strict.
      earnedAt = new Date(0).toISOString();
    }

    seen.add(id);
    out.push({
      id,
      source: "monad_stake",
      asset: "MON",
      amount: formatBaseUnits(decoded.amount, 18),
      earnedAt,
      rawType: "CLAIMED_STAKING_REWARDS",
      meta: {
        validatorId: decoded.validatorId.toString(),
        epoch: decoded.epoch.toString(),
        txHash: tx,
        logIndex,
        kind: "claimed",
      },
    });
  }

  return out.sort(
    (a, b) => Date.parse(b.earnedAt) - Date.parse(a.earnedAt),
  );
}

export function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function resolveArchiveRpcUrl(override?: string): string {
  const fromEnv =
    override?.trim() ||
    process.env.MONAD_ARCHIVE_RPC_URL?.trim() ||
    "";
  return fromEnv || DEFAULT_MONAD_ARCHIVE_RPC_URL;
}

export function resolveExplorerConfig(opts?: {
  apiUrl?: string;
  apiKey?: string;
  chainId?: number;
}): { apiUrl: string; apiKey: string; chainId: number } | null {
  const apiKey =
    opts?.apiKey?.trim() ||
    process.env.MONAD_EXPLORER_API_KEY?.trim() ||
    process.env.ETHERSCAN_API_KEY?.trim() ||
    "";
  if (!apiKey) return null;
  return {
    apiUrl:
      opts?.apiUrl?.trim() ||
      process.env.MONAD_EXPLORER_API_URL?.trim() ||
      DEFAULT_MONAD_EXPLORER_API_URL,
    apiKey,
    chainId:
      opts?.chainId ??
      envInt("MONAD_EXPLORER_CHAIN_ID", DEFAULT_MONAD_EXPLORER_CHAIN_ID),
  };
}

export function createHttpJsonRpc(rpcUrl: string, fetchImpl: typeof fetch = fetch): JsonRpcTransport {
  return async (method, params) => {
    const res = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
      }),
    });
    if (!res.ok) {
      throw new MonadClaimHistoryError(
        `Monad archive RPC HTTP ${res.status}`,
      );
    }
    const body = (await res.json()) as {
      result?: unknown;
      error?: { message?: string };
    };
    if (body.error?.message) {
      throw new MonadClaimHistoryError(body.error.message);
    }
    return body.result;
  };
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(1, items.length)) },
    async () => {
      while (true) {
        const i = next;
        next += 1;
        if (i >= items.length) return;
        out[i] = await fn(items[i]!, i);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

export async function resolveClaimLogBlockRange(
  rpc: JsonRpcTransport,
  opts?: {
    fromBlock?: bigint;
    toBlock?: bigint;
    maxBlocks?: number;
    startMs?: number | null;
    /** When true, do not clamp to maxBlocks (single-shot full history). */
    uncapped?: boolean;
  },
): Promise<{ fromBlock: bigint; toBlock: bigint; capped: boolean }> {
  const latestHex = (await rpc("eth_blockNumber", [])) as Hex;
  const latest = hexToBigInt(latestHex);
  const maxBlocks = BigInt(
    opts?.maxBlocks ??
      envInt("MONAD_CLAIM_HISTORY_MAX_BLOCKS", DEFAULT_CLAIM_HISTORY_MAX_BLOCKS),
  );

  let toBlock = opts?.toBlock ?? latest;
  if (toBlock > latest) toBlock = latest;

  let fromBlock = opts?.fromBlock;
  let capped = false;
  if (fromBlock == null) {
    if (opts?.startMs != null && Number.isFinite(opts.startMs)) {
      const latestBlock = (await rpc("eth_getBlockByNumber", [
        toHex(toBlock),
        false,
      ])) as { timestamp?: Hex } | null;
      const latestTs = latestBlock?.timestamp
        ? Number(hexToBigInt(latestBlock.timestamp)) * 1000
        : Date.now();
      const deltaMs = Math.max(0, latestTs - opts.startMs);
      const blocksBack = BigInt(
        Math.ceil(deltaMs / MONAD_BLOCK_TIME_MS) + 100,
      );
      fromBlock = toBlock > blocksBack ? toBlock - blocksBack : 0n;
    } else if (opts?.uncapped) {
      fromBlock = 0n;
    } else {
      fromBlock = toBlock > maxBlocks ? toBlock - maxBlocks : 0n;
      if (toBlock - fromBlock >= maxBlocks && fromBlock > 0n) capped = true;
    }
  }
  if (!opts?.uncapped && toBlock - fromBlock > maxBlocks) {
    fromBlock = toBlock - maxBlocks;
    capped = true;
  }
  if (fromBlock < 0n) fromBlock = 0n;
  return { fromBlock, toBlock, capped };
}

/**
 * Single eth_getLogs for ClaimRewards filtered by delegator (topic2).
 * Works end-to-end on rpc1.monad.xyz for the full chain; fails on narrow RPCs.
 */
export async function fetchClaimRewardsViaWideGetLogs(
  delegator: Address,
  rpc: JsonRpcTransport,
  opts?: {
    fromBlock?: bigint;
    toBlock?: bigint;
    startMs?: number | null;
    endMs?: number | null;
  },
): Promise<{ events: EarnEvent[]; fromBlock: bigint; toBlock: bigint }> {
  const range = await resolveClaimLogBlockRange(rpc, {
    fromBlock: opts?.fromBlock,
    toBlock: opts?.toBlock,
    startMs: opts?.startMs,
    uncapped: opts?.fromBlock == null && opts?.startMs == null,
  });
  if (range.fromBlock > range.toBlock) {
    return { events: [], fromBlock: range.fromBlock, toBlock: range.toBlock };
  }

  const topic2 = padAddressTopic(delegator);
  const result = (await rpc("eth_getLogs", [
    {
      fromBlock: toHex(range.fromBlock),
      toBlock: toHex(range.toBlock),
      address: MONAD_STAKING_PRECOMPILE,
      topics: [CLAIM_REWARDS_TOPIC0, null, topic2],
    },
  ])) as RpcLog[] | null;

  const logs = Array.isArray(result) ? result : [];
  return {
    events: claimRewardsLogsToEarnEvents(delegator, logs, {
      startMs: opts?.startMs,
      endMs: opts?.endMs,
    }),
    fromBlock: range.fromBlock,
    toBlock: range.toBlock,
  };
}

/**
 * Chunked eth_getLogs for ClaimRewards filtered by delegator (topic2).
 * Fallback for RPCs that reject wide ranges (e.g. rpc3 ≈ 1000-block windows).
 */
export async function fetchClaimRewardsViaArchiveRpc(
  delegator: Address,
  rpc: JsonRpcTransport,
  opts?: {
    fromBlock?: bigint;
    toBlock?: bigint;
    chunkBlocks?: number;
    maxBlocks?: number;
    concurrency?: number;
    startMs?: number | null;
    endMs?: number | null;
    /** Prefer single wide getLogs before chunking (default true). */
    preferWide?: boolean;
  },
): Promise<{ events: EarnEvent[]; mode: "wide" | "chunked"; complete: boolean }> {
  const preferWide = opts?.preferWide !== false;

  if (preferWide) {
    try {
      const wide = await fetchClaimRewardsViaWideGetLogs(delegator, rpc, {
        fromBlock: opts?.fromBlock,
        toBlock: opts?.toBlock,
        startMs: opts?.startMs,
        endMs: opts?.endMs,
      });
      const complete =
        opts?.fromBlock != null ||
        opts?.startMs != null ||
        wide.fromBlock === 0n;
      return { events: wide.events, mode: "wide", complete };
    } catch {
      /* fall through to chunked */
    }
  }

  const range = await resolveClaimLogBlockRange(rpc, {
    fromBlock: opts?.fromBlock,
    toBlock: opts?.toBlock,
    maxBlocks: opts?.maxBlocks,
    startMs: opts?.startMs,
    uncapped: false,
  });
  if (range.fromBlock > range.toBlock) {
    return { events: [], mode: "chunked", complete: !range.capped };
  }

  const chunk = BigInt(
    opts?.chunkBlocks ??
      envInt("MONAD_CLAIM_LOGS_CHUNK_BLOCKS", DEFAULT_CLAIM_LOGS_CHUNK_BLOCKS),
  );
  const concurrency =
    opts?.concurrency ??
    envInt("MONAD_CLAIM_LOGS_CONCURRENCY", DEFAULT_CLAIM_LOGS_CONCURRENCY);

  const topic2 = padAddressTopic(delegator);
  const ranges: Array<{ from: bigint; to: bigint }> = [];
  for (let start = range.fromBlock; start <= range.toBlock; start += chunk) {
    const end =
      start + chunk - 1n > range.toBlock ? range.toBlock : start + chunk - 1n;
    ranges.push({ from: start, to: end });
  }

  let hardFailures = 0;
  const pages = await mapPool(ranges, concurrency, async (r) => {
    try {
      const result = (await rpc("eth_getLogs", [
        {
          fromBlock: toHex(r.from),
          toBlock: toHex(r.to),
          address: MONAD_STAKING_PRECOMPILE,
          topics: [CLAIM_REWARDS_TOPIC0, null, topic2],
        },
      ])) as RpcLog[] | null;
      return Array.isArray(result) ? result : [];
    } catch {
      hardFailures += 1;
      return [] as RpcLog[];
    }
  });

  if (hardFailures === ranges.length && ranges.length > 0) {
    throw new MonadClaimHistoryError(
      "All chunked eth_getLogs requests failed",
    );
  }

  const logs = pages.flat().sort((a, b) =>
    logSortKey(a).localeCompare(logSortKey(b)),
  );
  return {
    events: claimRewardsLogsToEarnEvents(delegator, logs, {
      startMs: opts?.startMs,
      endMs: opts?.endMs,
    }),
    mode: "chunked",
    complete: !range.capped && hardFailures === 0,
  };
}

/**
 * Etherscan API V2 getLogs — indexed ClaimRewards for a delegator.
 * Free tier supports Monad (chainid 143). Requires API key.
 */
export async function fetchClaimRewardsViaExplorer(
  delegator: Address,
  opts: {
    apiUrl: string;
    apiKey: string;
    chainId: number;
    fromBlock?: number;
    toBlock?: number | "latest";
    startMs?: number | null;
    endMs?: number | null;
    fetchImpl?: typeof fetch;
  },
): Promise<EarnEvent[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const topic2 = padAddressTopic(delegator);
  const all: RpcLog[] = [];
  let page = 1;
  const offset = 1000;

  for (let i = 0; i < 50; i += 1) {
    const url = new URL(opts.apiUrl);
    url.searchParams.set("chainid", String(opts.chainId));
    url.searchParams.set("module", "logs");
    url.searchParams.set("action", "getLogs");
    url.searchParams.set("address", MONAD_STAKING_PRECOMPILE);
    url.searchParams.set("topic0", CLAIM_REWARDS_TOPIC0);
    url.searchParams.set("topic2", topic2);
    url.searchParams.set("topic0_2_opr", "and");
    url.searchParams.set("fromBlock", String(opts.fromBlock ?? 0));
    url.searchParams.set(
      "toBlock",
      opts.toBlock === undefined ? "latest" : String(opts.toBlock),
    );
    url.searchParams.set("page", String(page));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("apikey", opts.apiKey);

    const res = await fetchImpl(url.toString());
    if (!res.ok) {
      throw new MonadClaimHistoryError(
        `Monad explorer HTTP ${res.status}`,
      );
    }
    const body = (await res.json()) as {
      status?: string;
      message?: string;
      result?: RpcLog[] | string;
    };
    if (body.status === "0") {
      const result = body.result;
      if (
        typeof result === "string" &&
        /no records|no logs/i.test(result)
      ) {
        break;
      }
      throw new MonadClaimHistoryError(
        typeof result === "string"
          ? result
          : body.message || "Monad explorer getLogs failed",
      );
    }
    const rows = Array.isArray(body.result) ? body.result : [];
    all.push(...rows);
    if (rows.length < offset) break;
    page += 1;
  }

  return claimRewardsLogsToEarnEvents(delegator, all, {
    startMs: opts.startMs,
    endMs: opts.endMs,
  });
}

async function tryArchiveClaimHistory(
  delegator: Address,
  rpcUrl: string,
  opts: {
    startMs?: number | null;
    endMs?: number | null;
    fetchImpl?: typeof fetch;
    jsonRpc?: JsonRpcTransport;
  },
): Promise<{
  events: EarnEvent[];
  mode: "wide" | "chunked";
  complete: boolean;
}> {
  const rpc =
    opts.jsonRpc ??
    createHttpJsonRpc(rpcUrl, opts.fetchImpl ?? fetch);
  return fetchClaimRewardsViaArchiveRpc(delegator, rpc, {
    startMs: opts.startMs,
    endMs: opts.endMs,
  });
}

/**
 * Best-effort claimed reward history (no self-hosted archive node required).
 * Prefer explorer (if key) → public rpc1 wide getLogs (full chain) →
 * chunked fallback → empty + soft note.
 * Never throws for transport failures (soft-degrade); decode bugs still throw.
 */
export async function fetchMonadClaimedRewards(
  delegator: Address,
  opts?: {
    startMs?: number | null;
    endMs?: number | null;
    archiveRpcUrl?: string;
    explorerApiUrl?: string;
    explorerApiKey?: string;
    explorerChainId?: number;
    fetchImpl?: typeof fetch;
    jsonRpc?: JsonRpcTransport;
    /** Skip explorer even if key present (tests). */
    preferArchive?: boolean;
  },
): Promise<ClaimHistoryResult> {
  const startMs = opts?.startMs ?? null;
  const endMs = opts?.endMs ?? null;
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const notes: string[] = [];

  const explorer = opts?.preferArchive
    ? null
    : resolveExplorerConfig({
        apiUrl: opts?.explorerApiUrl,
        apiKey: opts?.explorerApiKey,
        chainId: opts?.explorerChainId,
      });

  if (explorer) {
    try {
      const events = await fetchClaimRewardsViaExplorer(delegator, {
        ...explorer,
        startMs,
        endMs,
        fetchImpl,
      });
      return { events, source: "explorer", complete: true };
    } catch (err) {
      notes.push(
        err instanceof Error
          ? `Explorer claim history unavailable (${err.message}).`
          : "Explorer claim history unavailable.",
      );
    }
  }

  const primaryUrl = resolveArchiveRpcUrl(opts?.archiveRpcUrl);
  const candidates = [primaryUrl];
  if (
    !opts?.jsonRpc &&
    primaryUrl !== FALLBACK_MONAD_ARCHIVE_RPC_URL &&
    !opts?.archiveRpcUrl
  ) {
    candidates.push(FALLBACK_MONAD_ARCHIVE_RPC_URL);
  }

  let lastErr: unknown;
  for (const url of candidates) {
    try {
      const archive = await tryArchiveClaimHistory(delegator, url, {
        startMs,
        endMs,
        // Leave unset so tryArchiveClaimHistory applies `?? fetch` default.
        fetchImpl: opts?.fetchImpl,
        jsonRpc: opts?.jsonRpc,
      });
      const infoParts = [...notes];
      if (archive.mode === "wide") {
        infoParts.push(
          startMs != null || endMs != null || !archive.complete
            ? "Claimed history from public Monad RPC for the sync window."
            : "Claimed history from public Monad RPC (full ClaimRewards for this wallet).",
        );
      } else {
        const cap = envInt(
          "MONAD_CLAIM_HISTORY_MAX_BLOCKS",
          DEFAULT_CLAIM_HISTORY_MAX_BLOCKS,
        );
        infoParts.push(
          `Claimed history from chunked archive RPC (last ~${cap.toLocaleString()} blocks). Optional: set MONAD_EXPLORER_API_KEY for Monadscan-indexed history.`,
        );
      }
      return {
        events: archive.events,
        source: "archive_rpc",
        complete: archive.complete,
        /* v8 ignore next -- infoParts always includes a source note */
        info: infoParts.filter(Boolean).join(" ") || undefined,
      };
    } catch (err) {
      lastErr = err;
      if (opts?.jsonRpc) break; // injected transport — don't retry fallback URL
    }
  }

  const detail =
    lastErr instanceof Error ? lastErr.message : "archive RPC failed";
  return {
    events: [],
    source: "none",
    complete: false,
    info: [
      ...notes,
      `Claimed reward history unavailable (${detail}). Showing pending unclaimed only.`,
    ].join(" "),
  };
}
