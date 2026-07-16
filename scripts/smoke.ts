/**
 * Live / fixture smoke for Phase 1 adapters.
 *
 * Fixture path (default when SYNC_LIVE!=1):
 *   pnpm test:smoke
 *
 * Live path (requires secrets in env):
 *   SYNC_LIVE=1 pnpm test:smoke
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, http } from "viem";
import { normalizeBinanceRewards } from "../web/src/lib/adapters/binance";
import { normalizeOkxEarn } from "../web/src/lib/adapters/okx";
import {
  fetchMonadStakeEarnEvents,
  decodeGetDelegatorResult,
  delegatorStatesToEarnEvents,
} from "../web/src/lib/adapters/monad-stake";
import { fetchBinanceEarnEvents } from "../web/src/lib/adapters/binance";
import { fetchOkxEarnEvents } from "../web/src/lib/adapters/okx";

const root = join(process.cwd(), "tests", "fixtures");
const live = process.env.SYNC_LIVE === "1";

async function main() {
  console.log(`YieldScope smoke (${live ? "LIVE" : "fixture"})`);

  // Binance
  if (live && (process.env.BINANCE_API_KEY || process.env.BINANCE_ACCESS_TOKEN)) {
    const events = await fetchBinanceEarnEvents({
      apiKey: process.env.BINANCE_API_KEY ?? "",
      apiSecret: process.env.BINANCE_API_SECRET ?? "",
      accessToken: process.env.BINANCE_ACCESS_TOKEN,
    });
    console.log(`binance live: ${events.length} events`);
  } else {
    const payload = JSON.parse(
      readFileSync(join(root, "binance", "rewards-page1.json"), "utf8"),
    );
    const events = normalizeBinanceRewards(payload);
    console.log(`binance fixture: ${events.length} events`);
  }

  // OKX
  if (
    live &&
    (process.env.OKX_API_KEY || process.env.OKX_ACCESS_TOKEN)
  ) {
    const events = await fetchOkxEarnEvents({
      apiKey: process.env.OKX_API_KEY ?? "",
      apiSecret: process.env.OKX_API_SECRET ?? "",
      passphrase: process.env.OKX_PASSPHRASE,
      accessToken: process.env.OKX_ACCESS_TOKEN,
    });
    console.log(`okx live: ${events.length} events`);
  } else {
    const payload = JSON.parse(
      readFileSync(join(root, "okx", "lending-history.json"), "utf8"),
    );
    const events = normalizeOkxEarn(payload);
    console.log(`okx fixture: ${events.length} events`);
  }

  // Monad
  if (live && process.env.MONAD_DEMO_ADDRESS) {
    const rpc = process.env.MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz";
    const client = createPublicClient({ transport: http(rpc) });
    const address = process.env.MONAD_DEMO_ADDRESS as `0x${string}`;
    const validatorIds = process.env.MONAD_VALIDATOR_IDS
      ? process.env.MONAD_VALIDATOR_IDS.split(",").map((x) => BigInt(x.trim()))
      : undefined;
    try {
      const events = await fetchMonadStakeEarnEvents(
        address,
        async ({ to, data }) => {
          const r = await client.call({ to, data });
          if (!r.data) throw new Error("empty eth_call");
          return r.data;
        },
        { validatorIds },
      );
      console.log(`monad live: ${events.length} events`);
    } catch (err) {
      console.error(
        "monad live failed (precompile may reject STATICCALL via eth_call):",
        err instanceof Error ? err.message : err,
      );
      process.exitCode = 1;
    }
  } else {
    const fixture = JSON.parse(
      readFileSync(join(root, "monad", "getDelegator-sample.json"), "utf8"),
    );
    const decoded = decodeGetDelegatorResult(fixture.encodedGetDelegatorResult);
    const events = delegatorStatesToEarnEvents(fixture.delegator, [
      { validatorId: BigInt(fixture.validatorId), ...decoded },
    ]);
    console.log(`monad fixture: ${events.length} events`);
  }

  console.log("smoke done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
