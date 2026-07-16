import { createPublicClient, http, type Address } from "viem";
import { fetchBinanceEarnEvents } from "./adapters/binance";
import { fetchOkxEarnEvents } from "./adapters/okx";
import { fetchMonadStakeEarnEvents } from "./adapters/monad-stake";
import { fetchLuncStakeEarnEvents } from "./adapters/lunc-stake";
import type { AdapterResult, CexCredentials, EarnEvent, SourceId } from "./adapters/types";
import { replaceSourceEvents, getLedger } from "./ledger-store";
import {
  LedgerPersistError,
  persistSourceSync,
} from "./ledger-db";
import { join } from "node:path";

function useFixtures(): boolean {
  return process.env.USE_FIXTURE_DEMO === "1";
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
    const { normalizeLuncRewards } = await import("./adapters/lunc-stake");
    const payload = JSON.parse(
      readFileSync(join(root, "lunc", "rewards-sample.json"), "utf8"),
    );
    return normalizeLuncRewards(
      "terra1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a",
      payload,
      new Date("2024-07-01T00:00:00.000Z"),
    );
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
): Promise<AdapterResult> {
  replaceSourceEvents(source, result);

  try {
    await persistSourceSync({
      userId: ctx.userId,
      email: ctx.email,
      source,
      status: result.status,
      events: result.events,
      error: result.error,
      walletAddress:
        source === "monad_stake" ? ctx.walletAddress : undefined,
      chainId: ctx.chainId,
    });
  } catch (err) {
    const message =
      err instanceof LedgerPersistError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    replaceSourceEvents(source, {
      status: "error",
      events: [],
      error: `Persist failed: ${message}`,
    });
    return {
      status: "error",
      events: [],
      error: `Persist failed: ${message}`,
    };
  }
  return result;
}

export async function syncBinance(
  creds: CexCredentials | null,
  ctx: SyncContext,
): Promise<AdapterResult> {
  try {
    if (useFixtures()) {
      const events = await loadFixtureEvents("binance");
      return commitSource(ctx, "binance", { status: "ok", events });
    }
    if (!creds) {
      return commitSource(ctx, "binance", {
        status: "not_connected",
        events: [],
        error: "Not connected",
      });
    }
    const events = await fetchBinanceEarnEvents(creds);
    return commitSource(ctx, "binance", { status: "ok", events });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return commitSource(ctx, "binance", { status: "error", events: [], error });
  }
}

export async function syncOkx(
  creds: CexCredentials | null,
  ctx: SyncContext,
): Promise<AdapterResult> {
  try {
    if (useFixtures()) {
      const events = await loadFixtureEvents("okx");
      return commitSource(ctx, "okx", { status: "ok", events });
    }
    if (!creds) {
      return commitSource(ctx, "okx", {
        status: "not_connected",
        events: [],
        error: "Not connected",
      });
    }
    const events = await fetchOkxEarnEvents(creds);
    return commitSource(ctx, "okx", { status: "ok", events });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return commitSource(ctx, "okx", { status: "error", events: [], error });
  }
}

export async function syncMonadStake(
  address: Address | null,
  ctx: SyncContext,
): Promise<AdapterResult> {
  const walletCtx: SyncContext = {
    ...ctx,
    walletAddress: address ?? ctx.walletAddress,
    chainId: ctx.chainId ?? 10143,
  };
  try {
    if (useFixtures()) {
      const events = await loadFixtureEvents("monad_stake");
      return commitSource(walletCtx, "monad_stake", { status: "ok", events });
    }
    if (!address) {
      return commitSource(walletCtx, "monad_stake", {
        status: "not_connected",
        events: [],
        error: "Wallet not connected",
      });
    }
    const rpcUrl =
      process.env.MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz";
    const client = createPublicClient({ transport: http(rpcUrl) });
    const events = await fetchMonadStakeEarnEvents(
      address,
      async ({ to, data }) =>
        client.call({ to, data }).then((r) => {
          if (!r.data)
            throw new Error("Empty eth_call result from Monad staking");
          return r.data;
        }),
    );
    return commitSource(walletCtx, "monad_stake", { status: "ok", events });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return commitSource(walletCtx, "monad_stake", {
      status: "error",
      events: [],
      error,
    });
  }
}

export async function syncLuncStake(
  addressOrLink: string | null,
  ctx: SyncContext,
): Promise<AdapterResult> {
  try {
    if (useFixtures()) {
      const events = await loadFixtureEvents("lunc_stake");
      return commitSource(ctx, "lunc_stake", { status: "ok", events });
    }
    if (!addressOrLink) {
      return commitSource(ctx, "lunc_stake", {
        status: "not_connected",
        events: [],
        error: "LUNC address not provided",
      });
    }
    const events = await fetchLuncStakeEarnEvents(addressOrLink, {
      lcdUrl: process.env.LUNC_LCD_URL,
    });
    return commitSource(ctx, "lunc_stake", { status: "ok", events });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return commitSource(ctx, "lunc_stake", {
      status: "error",
      events: [],
      error,
    });
  }
}

export function snapshot() {
  return getLedger();
}
