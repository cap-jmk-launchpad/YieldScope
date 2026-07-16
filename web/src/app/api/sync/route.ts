import { NextResponse } from "next/server";
import type { CexCredentials } from "@/lib/adapters/types";
import { syncBinance, syncMonadStake, syncOkx, snapshot } from "@/lib/sync";
import type { Address } from "viem";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    source?: "binance" | "okx" | "monad_stake" | "all";
    binance?: CexCredentials;
    okx?: CexCredentials;
    address?: string;
  };

  const source = body.source ?? "all";
  const results: Record<string, unknown> = {};

  if (source === "binance" || source === "all") {
    results.binance = await syncBinance(body.binance ?? readEnvBinance());
  }
  if (source === "okx" || source === "all") {
    results.okx = await syncOkx(body.okx ?? readEnvOkx());
  }
  if (source === "monad_stake" || source === "all") {
    const address = (body.address ||
      process.env.MONAD_DEMO_ADDRESS ||
      null) as Address | null;
    results.monad_stake = await syncMonadStake(address);
  }

  return NextResponse.json({ results, ledger: snapshot() });
}

function readEnvBinance(): CexCredentials | null {
  const accessToken = process.env.BINANCE_ACCESS_TOKEN;
  const apiKey = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_API_SECRET;
  if (accessToken) return { apiKey: "", apiSecret: "", accessToken };
  if (apiKey && apiSecret) return { apiKey, apiSecret };
  return null;
}

function readEnvOkx(): CexCredentials | null {
  const accessToken = process.env.OKX_ACCESS_TOKEN;
  const apiKey = process.env.OKX_API_KEY;
  const apiSecret = process.env.OKX_API_SECRET;
  const passphrase = process.env.OKX_PASSPHRASE;
  if (accessToken) return { apiKey: "", apiSecret: "", accessToken };
  if (apiKey && apiSecret && passphrase) {
    return { apiKey, apiSecret, passphrase };
  }
  return null;
}
