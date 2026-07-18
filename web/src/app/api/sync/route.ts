import { NextResponse } from "next/server";
import type { CexCredentials } from "@/lib/adapters/types";
import { requireUser } from "@/lib/auth/require-user";
import {
  loadBinanceCredentials,
  loadLuncAddress,
  loadMonadWalletAddress,
  loadOkxCredentials,
} from "@/lib/credentials-db";
import { loadDbLedger, LedgerPersistError } from "@/lib/ledger-db";
import {
  syncBinance,
  syncLuncStake,
  syncMonadStake,
  syncOkx,
} from "@/lib/sync";
import type { Address } from "viem";

export async function POST(req: Request) {
  const gate = await requireUser();
  if (gate.error) return gate.error;

  const body = (await req.json().catch(() => ({}))) as {
    source?: "binance" | "okx" | "monad_stake" | "lunc_stake" | "all";
    binance?: CexCredentials;
    okx?: CexCredentials;
    address?: string;
    luncAddress?: string;
    chainId?: number;
  };

  const storedBinance =
    body.binance ?? (await loadBinanceCredentials(gate.user.id));
  const storedOkx = body.okx ?? (await loadOkxCredentials(gate.user.id));
  const storedLunc =
    body.luncAddress ??
    (await loadLuncAddress(gate.user.id)) ??
    process.env.LUNC_DEMO_ADDRESS ??
    null;
  const storedWallet =
    body.address ??
    (await loadMonadWalletAddress(gate.user.id)) ??
    process.env.MONAD_DEMO_ADDRESS ??
    null;

  const ctx = {
    userId: gate.user.id,
    email: gate.user.email,
    walletAddress: storedWallet,
    chainId: body.chainId ?? 10143,
    luncAddress: storedLunc,
  };

  const source = body.source ?? "all";
  const results: Record<string, unknown> = {};

  try {
    if (source === "binance" || source === "all") {
      results.binance = await syncBinance(
        storedBinance ?? readEnvBinance(),
        ctx,
      );
    }
    if (source === "okx" || source === "all") {
      results.okx = await syncOkx(storedOkx ?? readEnvOkx(), ctx);
    }
    if (source === "monad_stake" || source === "all") {
      const address = storedWallet as Address | null;
      results.monad_stake = await syncMonadStake(address, {
        ...ctx,
        walletAddress: address,
      });
    }
    if (source === "lunc_stake" || source === "all") {
      results.lunc_stake = await syncLuncStake(storedLunc, ctx);
    }

    const ledger = await loadDbLedger(gate.user.id);
    const failed = Object.values(results).some(
      (r) =>
        r &&
        typeof r === "object" &&
        "status" in r &&
        (r as { status: string }).status === "error" &&
        String((r as { error?: string }).error ?? "").startsWith(
          "Persist failed",
        ),
    );
    if (failed) {
      return NextResponse.json(
        { error: "Sync persist failed — no silent success.", results, ledger },
        { status: 502 },
      );
    }
    return NextResponse.json({ results, ledger });
  } catch (err) {
    const message =
      err instanceof LedgerPersistError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Sync failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
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
