import { createPublicClient, http, type Address, type Hex } from "viem";
import {
  BinanceAdapterError,
  fetchBinanceEarnEvents,
} from "./adapters/binance";
import { fetchOkxEarnEvents, OkxAdapterError } from "./adapters/okx";
import {
  scanMonadStake,
  type RpcCall,
} from "./adapters/monad-stake";
import {
  fetchLuncStakeEarnEvents,
} from "./adapters/lunc-stake";
import type {
  AdapterResult,
  CexCredentials,
  EarnEvent,
  EarnFetchOptions,
  SourceId,
} from "./adapters/types";
import {
  DEFAULT_MONAD_CHAIN_ID,
  defaultMonadRpcUrl,
} from "./contracts";
import { replaceSourceEvents, getLedger } from "./ledger-store";
import {
  getSourceHighWaterMs,
  persistSourceSync,
} from "./ledger-db";
import {
  INCREMENTAL_OVERLAP_MS,
  type ResolvedSyncWindow,
  type SyncRange,
  filterEventsByWindow,
  isPointInTimeSource,
  resolveSyncRange,
} from "./sync-range";
import { join } from "node:path";

function useFixtures(): boolean {
  return process.env.USE_FIXTURE_DEMO === "1";
}

/** Strip infra jargon from adapter failures before they reach the UI. */
export function userFacingAdapterError(err: unknown, fallback: string): string {
  // Always keep typed CEX adapter errors (incl. "Malformed …" / HTTP bodies).
  if (err instanceof BinanceAdapterError || err instanceof OkxAdapterError) {
    return err.message;
  }
  const raw = err instanceof Error ? err.message : String(err);
  // Keep exchange-authored auth hints (incl. OKX 501xx / "OKX HTTP …").
  if (
    /^(OKX|Binance|LUNC|Monad)\b/i.test(raw) ||
    /\b501\d{2}\b/.test(raw) ||
    /re-save|passphrase|API key/i.test(raw)
  ) {
    return raw;
  }
  if (
    /LCD|RPC|eth_call|precompile|HTTP \d+|malformed|decode|STATICCALL|fail.?closed|persist|Postgres|Supabase|service.?role/i.test(
      raw,
    )
  ) {
    return fallback;
  }
  return raw || fallback;
}

/** Resolve fixtures whether vitest cwd is repo root or web/. */
function fixturesRoot(): string {
  const cwd = process.cwd();
  if (cwd.replace(/\\/g, "/").endsWith("/web")) {
    return join(cwd, "..", "tests", "fixtures");
  }
  return join(cwd, "tests", "fixtures");
}

export interface SyncContext {
  userId: string;
  email?: string | null;
  walletAddress?: string | null;
  chainId?: number;
  luncAddress?: string | null;
  /** Resolved sync window; default all-time when omitted. */
  window?: ResolvedSyncWindow;
  /**
   * Force full historical re-fetch for CEX sources (All time + force).
   * Ignored for custom date ranges.
   */
  forceFull?: boolean;
}

export type CexPersistPlan = {
  opts: EarnFetchOptions;
  persistMode: "replace" | "merge" | "upsert";
  mergeFromMs?: number | null;
  mergeToMs?: number | null;
};

/**
 * Resolve CEX / LUNC / Monad-claim fetch + persist plan.
 * - Custom range → fetch window, merge-replace in window
 * - All time + forceFull / no high-water → full backfill, replace
 * - All time with existing events → incremental from high-water − overlap
 */
export async function resolveCexSyncPlan(
  ctx: SyncContext,
  source: "binance" | "okx" | "lunc_stake" | "monad_stake",
  nowMs = Date.now(),
): Promise<CexPersistPlan> {
  const window =
    ctx.window ?? { mode: "all" as const, fromMs: null, toMs: null };

  if (window.mode === "custom") {
    return {
      opts: {
        startMs: window.fromMs,
        endMs: window.toMs,
      },
      persistMode: "merge",
      mergeFromMs: window.fromMs,
      mergeToMs: window.toMs,
    };
  }

  if (ctx.forceFull) {
    return {
      opts: { allTime: true },
      persistMode: "replace",
    };
  }

  let highWater: number | null = null;
  try {
    highWater = await getSourceHighWaterMs(ctx.userId, source);
  } catch {
    highWater = null;
  }

  if (highWater == null) {
    return {
      opts: { allTime: true },
      persistMode: "replace",
    };
  }

  const startMs = Math.max(0, highWater - INCREMENTAL_OVERLAP_MS);
  return {
    opts: { startMs, endMs: nowMs },
    persistMode: "upsert",
    mergeFromMs: startMs,
    mergeToMs: nowMs,
  };
}

async function loadFixtureEvents(
  source: "binance" | "okx" | "lunc_stake" | "monad_stake",
): Promise<EarnEvent[]> {
  const { readFileSync } = await import("node:fs");
  const root = fixturesRoot();
  if (source === "binance") {
    const { normalizeBinanceRewards } = await import("./adapters/binance");
    const payload = JSON.parse(
      readFileSync(join(root, "binance", "rewards-page1.json"), "utf8"),
    );
    return normalizeBinanceRewards(payload);
  }
  if (source === "okx") {
    const { normalizeOkxEarn } = await import("./adapters/okx");
    const payload = JSON.parse(
      readFileSync(join(root, "okx", "lending-history.json"), "utf8"),
    );
    return normalizeOkxEarn(payload);
  }
  if (source === "lunc_stake") {
    const {
      normalizeLuncRewards,
      normalizeWithdrawRewardTxs,
    } = await import("./adapters/lunc-stake");
    const addr = "terra1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a";
    const pending = normalizeLuncRewards(
      addr,
      JSON.parse(
        readFileSync(join(root, "lunc", "rewards-sample.json"), "utf8"),
      ),
      new Date("2024-07-01T00:00:00.000Z"),
    );
    const claimed = normalizeWithdrawRewardTxs(
      addr,
      JSON.parse(
        readFileSync(join(root, "lunc", "withdraw-txs-sample.json"), "utf8"),
      ).tx_responses ?? [],
    );
    return [...claimed, ...pending];
  }
  const { decodeGetDelegatorResult, delegatorStatesToEarnEvents } =
    await import("./adapters/monad-stake");
  const fixture = JSON.parse(
    readFileSync(join(root, "monad", "getDelegator-sample.json"), "utf8"),
  );
  const decoded = decodeGetDelegatorResult(fixture.encodedGetDelegatorResult);
  return delegatorStatesToEarnEvents(fixture.delegator, [
    { validatorId: BigInt(fixture.validatorId), ...decoded },
  ]);
}

async function commitSource(
  ctx: SyncContext,
  source: SourceId,
  result: AdapterResult,
  plan?: Pick<CexPersistPlan, "persistMode" | "mergeFromMs" | "mergeToMs">,
): Promise<AdapterResult> {
  // Point-in-time sources always full-replace (no historical range).
  // POINT_IN_TIME_SOURCES is empty today — true branch kept for API stability.
  const isPointInTime = isPointInTimeSource(source);
  /* v8 ignore next -- isPointInTime true only when POINT_IN_TIME_SOURCES is non-empty */
  const persistMode = isPointInTime
    ? "replace"
    : (plan?.persistMode ?? "replace");
  const storeMerge =
    persistMode === "merge"
      ? { mergeFromMs: plan?.mergeFromMs, mergeToMs: plan?.mergeToMs }
      : persistMode === "upsert"
        ? {
            mergeFromMs: plan?.mergeFromMs,
            mergeToMs: plan?.mergeToMs,
            upsertOnly: true,
          }
        : {};

  replaceSourceEvents(source, result, storeMerge);

  const window = ctx.window ?? { mode: "all" as const, fromMs: null, toMs: null };

  try {
    await persistSourceSync({
      userId: ctx.userId,
      email: ctx.email,
      source,
      status: result.status,
      events: result.events,
      error: result.error,
      info: result.info,
      walletAddress:
        source === "monad_stake" ? ctx.walletAddress : undefined,
      chainId: ctx.chainId,
      persistMode,
      ...(persistMode === "merge"
        ? {
            mergeFromMs: plan?.mergeFromMs,
            mergeToMs: plan?.mergeToMs,
          }
        : {}),
      syncMeta: {
        rangeMode: window.mode,
        rangeFromMs: window.fromMs,
        rangeToMs: window.toMs,
        forceFull: Boolean(ctx.forceFull),
        pointInTime: isPointInTime,
        rangeIgnored: isPointInTime,
      },
    });
  } catch {
    replaceSourceEvents(source, {
      status: "error",
      events: [],
      error: "Couldn’t save this source. Try syncing again.",
    });
    return {
      status: "error",
      events: [],
      error: "Couldn’t save this source. Try syncing again.",
    };
  }
  return result;
}

export async function syncBinance(
  creds: CexCredentials | null,
  ctx: SyncContext,
): Promise<AdapterResult> {
  try {
    // Credentials required even in fixture mode — never invent earn rows for
    // users who have not connected a source.
    if (!creds) {
      return commitSource(ctx, "binance", {
        status: "not_connected",
        events: [],
        error: "Not connected",
      });
    }
    const plan = await resolveCexSyncPlan(ctx, "binance");
    if (useFixtures()) {
      const events = filterEventsByWindow(
        await loadFixtureEvents("binance"),
        ctx.window ?? { mode: "all", fromMs: null, toMs: null },
      );
      return commitSource(ctx, "binance", { status: "ok", events }, plan);
    }
    const events = await fetchBinanceEarnEvents(creds, plan.opts);
    return commitSource(
      ctx,
      "binance",
      {
        status: "ok",
        events: filterEventsByWindow(
          events,
          ctx.window ?? { mode: "all", fromMs: null, toMs: null },
        ),
      },
      plan,
    );
  } catch (err) {
    const error = userFacingAdapterError(
      err,
      "Couldn’t read Binance earn history. Check your API key and try again.",
    );
    return commitSource(ctx, "binance", { status: "error", events: [], error });
  }
}

export async function syncOkx(
  creds: CexCredentials | null,
  ctx: SyncContext,
): Promise<AdapterResult> {
  try {
    if (!creds) {
      return commitSource(ctx, "okx", {
        status: "not_connected",
        events: [],
        error: "Not connected",
      });
    }
    const plan = await resolveCexSyncPlan(ctx, "okx");
    if (useFixtures()) {
      const events = filterEventsByWindow(
        await loadFixtureEvents("okx"),
        ctx.window ?? { mode: "all", fromMs: null, toMs: null },
      );
      return commitSource(ctx, "okx", { status: "ok", events }, plan);
    }
    const events = await fetchOkxEarnEvents(creds, plan.opts);
    return commitSource(
      ctx,
      "okx",
      {
        status: "ok",
        events: filterEventsByWindow(
          events,
          ctx.window ?? { mode: "all", fromMs: null, toMs: null },
        ),
      },
      plan,
    );
  } catch (err) {
    const error = userFacingAdapterError(
      err,
      "Couldn’t read OKX earn history. Check your API key and try again.",
    );
    return commitSource(ctx, "okx", { status: "error", events: [], error });
  }
}

/**
 * Adapt a viem public client `call` into the Monad stake RpcCall shape.
 * Exported for unit tests — live sync wires this to createPublicClient.
 */
export function monadRpcFromClient(client: {
  call: (args: { to: Address; data: Hex }) => Promise<{ data?: Hex }>;
}): RpcCall {
  return async ({ to, data }) =>
    client.call({ to, data }).then((r) => {
      if (!r.data)
        throw new Error("Empty eth_call result from Monad staking");
      return r.data;
    });
}

/**
 * Monad staking: pending unclaimed from getDelegations → getDelegator, plus
 * best-effort ClaimRewards history (explorer → archive RPC). Soft-degrades to
 * pending-only when history APIs fail (preserves prior claimed rows via upsert).
 */
export async function syncMonadStake(
  address: Address | null,
  ctx: SyncContext,
): Promise<AdapterResult> {
  const walletCtx: SyncContext = {
    ...ctx,
    walletAddress: address ?? null,
    chainId: ctx.chainId ?? DEFAULT_MONAD_CHAIN_ID,
  };
  try {
    // Wallet required even in fixture mode — demo 2.5 MONAD must not appear
    // for users who never connected a wallet.
    if (!address) {
      // Upsert-only: never wipe prior pending/claimed rows when the wallet
      // briefly disconnects during a Sync all.
      return commitSource(
        walletCtx,
        "monad_stake",
        {
          status: "not_connected",
          events: [],
          error: "Wallet not connected",
        },
        { persistMode: "upsert" },
      );
    }
    const plan = await resolveCexSyncPlan(walletCtx, "monad_stake");
    if (useFixtures()) {
      const events = filterEventsByWindow(
        await loadFixtureEvents("monad_stake"),
        ctx.window ?? { mode: "all", fromMs: null, toMs: null },
      );
      return commitSource(
        walletCtx,
        "monad_stake",
        { status: "ok", events },
        plan,
      );
    }
    const rpcUrl = defaultMonadRpcUrl(process.env.MONAD_RPC_URL);
    const client = createPublicClient({ transport: http(rpcUrl) });
    // resolveCexSyncPlan always sets endMs when !allTime; ?? null is defensive.
    let endMs: number | null;
    if (plan.opts.allTime) {
      endMs = Date.now();
    } else {
      /* v8 ignore next -- endMs is always set for custom/incremental plans */
      endMs = plan.opts.endMs ?? null;
    }
    const scan = await scanMonadStake(address, monadRpcFromClient(client), {
      startMs: plan.opts.startMs ?? null,
      endMs,
      asOf: new Date(),
    });

    // Soft-degrade / partial archive: never full-replace (would wipe older claims).
    // Full persist plan when explorer OR complete public-RPC history (rpc1 wide).
    const persistPlan =
      scan.claimHistorySource === "explorer" || scan.claimHistoryComplete
        ? plan
        : {
            persistMode: "upsert" as const,
            mergeFromMs: plan.mergeFromMs,
            mergeToMs: plan.mergeToMs,
          };

    const window =
      ctx.window ?? { mode: "all" as const, fromMs: null, toMs: null };
    const nowMs = Date.now();
    // Pending is a live getDelegator snapshot (earnedAt = sync time). Keep it
    // whenever the sync window reaches ~now — same rule as LUNC pending.
    const rangeReachesNow =
      window.mode === "all" ||
      window.toMs == null ||
      window.toMs >= nowMs - 86_400_000;
    let events = scan.pendingEvents;
    if (scan.claimHistorySource !== "none") {
      const claimedInWindow = filterEventsByWindow(
        scan.claimedEvents ?? [],
        window,
      );
      events = rangeReachesNow
        ? [...claimedInWindow, ...scan.pendingEvents]
        : claimedInWindow;
    }

    return commitSource(
      walletCtx,
      "monad_stake",
      {
        status: "ok",
        events,
        info: scan.info,
      },
      persistPlan,
    );
  } catch (err) {
    const error = userFacingAdapterError(
      err,
      "Couldn’t read Monad staking rewards. Check your wallet and try again.",
    );
    return commitSource(walletCtx, "monad_stake", {
      status: "error",
      events: [],
      error,
    });
  }
}

/**
 * LUNC: crawl claimed withdraw-reward / autostake txs (FCD account history;
 * LCD event-search fallback) for the sync window, plus current pending when
 * the window reaches “now”. Persist plan matches CEX (merge / replace / upsert).
 */
export async function syncLuncStake(
  addressOrLink: string | null,
  ctx: SyncContext,
): Promise<AdapterResult> {
  try {
    if (!addressOrLink) {
      return commitSource(ctx, "lunc_stake", {
        status: "not_connected",
        events: [],
        error: "LUNC address not provided",
      });
    }
    const plan = await resolveCexSyncPlan(ctx, "lunc_stake");
    if (useFixtures()) {
      const events = filterEventsByWindow(
        await loadFixtureEvents("lunc_stake"),
        ctx.window ?? { mode: "all", fromMs: null, toMs: null },
      );
      return commitSource(ctx, "lunc_stake", { status: "ok", events }, plan);
    }
    const events = await fetchLuncStakeEarnEvents(addressOrLink, {
      lcdUrl: process.env.LUNC_LCD_URL,
      ...plan.opts,
    });
    return commitSource(
      ctx,
      "lunc_stake",
      {
        status: "ok",
        events: filterEventsByWindow(
          events,
          ctx.window ?? { mode: "all", fromMs: null, toMs: null },
        ),
      },
      plan,
    );
  } catch (err) {
    const error = userFacingAdapterError(
      err,
      "Couldn’t read LUNC staking rewards. Check the address and try again.",
    );
    return commitSource(ctx, "lunc_stake", {
      status: "error",
      events: [],
      error,
    });
  }
}

export function buildSyncContext(
  base: Omit<SyncContext, "window" | "forceFull">,
  range?: SyncRange | null,
): SyncContext {
  return {
    ...base,
    window: resolveSyncRange(range),
    forceFull: Boolean(range?.forceFull),
  };
}

export function snapshot() {
  return getLedger();
}
