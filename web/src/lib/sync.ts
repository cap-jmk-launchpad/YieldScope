import { createPublicClient, http, type Address } from "viem";
import { fetchBinanceEarnEvents } from "./adapters/binance";
import { fetchOkxEarnEvents } from "./adapters/okx";
import { fetchMonadStakeEarnEvents } from "./adapters/monad-stake";
import type { AdapterResult, CexCredentials, EarnEvent } from "./adapters/types";
import { replaceSourceEvents, getLedger } from "./ledger-store";

const USE_FIXTURES = process.env.USE_FIXTURE_DEMO === "1";

async function loadFixtureEvents(
  source: "binance" | "okx",
): Promise<EarnEvent[]> {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const root = join(process.cwd(), "..", "tests", "fixtures");
  if (source === "binance") {
    const { normalizeBinanceRewards } = await import("./adapters/binance");
    const payload = JSON.parse(
      readFileSync(join(root, "binance", "rewards-page1.json"), "utf8"),
    );
    return normalizeBinanceRewards(payload);
  }
  const { normalizeOkxEarn } = await import("./adapters/okx");
  const payload = JSON.parse(
    readFileSync(join(root, "okx", "lending-history.json"), "utf8"),
  );
  return normalizeOkxEarn(payload);
}

export async function syncBinance(
  creds: CexCredentials | null,
): Promise<AdapterResult> {
  try {
    if (USE_FIXTURES) {
      const events = await loadFixtureEvents("binance");
      replaceSourceEvents("binance", { status: "ok", events });
      return { status: "ok", events };
    }
    if (!creds) {
      replaceSourceEvents("binance", {
        status: "not_connected",
        events: [],
        error: "Not connected",
      });
      return { status: "not_connected", events: [], error: "Not connected" };
    }
    const events = await fetchBinanceEarnEvents(creds);
    replaceSourceEvents("binance", { status: "ok", events });
    return { status: "ok", events };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    replaceSourceEvents("binance", { status: "error", events: [], error });
    return { status: "error", events: [], error };
  }
}

export async function syncOkx(
  creds: CexCredentials | null,
): Promise<AdapterResult> {
  try {
    if (USE_FIXTURES) {
      const events = await loadFixtureEvents("okx");
      replaceSourceEvents("okx", { status: "ok", events });
      return { status: "ok", events };
    }
    if (!creds) {
      replaceSourceEvents("okx", {
        status: "not_connected",
        events: [],
        error: "Not connected",
      });
      return { status: "not_connected", events: [], error: "Not connected" };
    }
    const events = await fetchOkxEarnEvents(creds);
    replaceSourceEvents("okx", { status: "ok", events });
    return { status: "ok", events };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    replaceSourceEvents("okx", { status: "error", events: [], error });
    return { status: "error", events: [], error };
  }
}

export async function syncMonadStake(
  address: Address | null,
): Promise<AdapterResult> {
  try {
    if (USE_FIXTURES) {
      const { readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { decodeGetDelegatorResult, delegatorStatesToEarnEvents } =
        await import("./adapters/monad-stake");
      const fixture = JSON.parse(
        readFileSync(
          join(process.cwd(), "..", "tests", "fixtures", "monad", "getDelegator-sample.json"),
          "utf8",
        ),
      );
      const decoded = decodeGetDelegatorResult(fixture.encodedGetDelegatorResult);
      const events = delegatorStatesToEarnEvents(fixture.delegator, [
        { validatorId: BigInt(fixture.validatorId), ...decoded },
      ]);
      replaceSourceEvents("monad_stake", { status: "ok", events });
      return { status: "ok", events };
    }
    if (!address) {
      replaceSourceEvents("monad_stake", {
        status: "not_connected",
        events: [],
        error: "Wallet not connected",
      });
      return {
        status: "not_connected",
        events: [],
        error: "Wallet not connected",
      };
    }
    const rpcUrl =
      process.env.MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz";
    const client = createPublicClient({ transport: http(rpcUrl) });
    const events = await fetchMonadStakeEarnEvents(address, async ({ to, data }) =>
      client.call({ to, data }).then((r) => {
        if (!r.data) throw new Error("Empty eth_call result from Monad staking");
        return r.data;
      }),
    );
    replaceSourceEvents("monad_stake", { status: "ok", events });
    return { status: "ok", events };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    replaceSourceEvents("monad_stake", { status: "error", events: [], error });
    return { status: "error", events: [], error };
  }
}

export function snapshot() {
  return getLedger();
}
