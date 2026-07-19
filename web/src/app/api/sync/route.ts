import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { DEFAULT_MONAD_CHAIN_ID } from "@/lib/contracts";
import {
  loadBinanceCredentials,
  loadLuncAddress,
  loadMonadWalletAddress,
  loadOkxCredentials,
} from "@/lib/credentials-db";
import { loadDbLedger, LedgerPersistError } from "@/lib/ledger-db";
import {
  buildSyncContext,
  syncBinance,
  syncLuncStake,
  syncMonadStake,
  syncOkx,
} from "@/lib/sync";
import { parseSyncRangeBody, resolveSyncRange, SyncRangeError } from "@/lib/sync-range";
import type { Address } from "viem";

export async function POST(req: Request) {
  const gate = await requireUser();
  if (gate.error) return gate.error;

  const body = (await req.json().catch(() => ({}))) as {
    source?: "binance" | "okx" | "monad_stake" | "lunc_stake" | "all";
    address?: string;
    chainId?: number;
  };

  let range;
  try {
    range = parseSyncRangeBody(body);
    resolveSyncRange(range);
  } catch (err) {
    const message =
      err instanceof SyncRangeError ? err.message : "Invalid sync range";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Only per-user saved credentials / wallet — never shared env demo keys or
  // MONAD_DEMO_ADDRESS / LUNC_DEMO_ADDRESS (those leak into every sync).
  const storedBinance = await loadBinanceCredentials(gate.user.id);
  const storedOkx = await loadOkxCredentials(gate.user.id);
  const storedLunc = await loadLuncAddress(gate.user.id);
  const storedWallet =
    body.address ?? (await loadMonadWalletAddress(gate.user.id)) ?? null;

  const ctx = buildSyncContext(
    {
      userId: gate.user.id,
      email: gate.user.email,
      walletAddress: storedWallet,
      chainId: body.chainId ?? DEFAULT_MONAD_CHAIN_ID,
      luncAddress: storedLunc,
    },
    range,
  );

  const source = body.source ?? "all";
  const results: Record<string, unknown> = {};

  try {
    if (source === "binance" || source === "all") {
      results.binance = await syncBinance(storedBinance, ctx);
    }
    if (source === "okx" || source === "all") {
      results.okx = await syncOkx(storedOkx, ctx);
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

    // Summary only — avoid re-shipping 10k+ events after every sync chunk.
    // Dashboard refreshes the events page + chart series once sync finishes.
    const ledger = await loadDbLedger(gate.user.id, { eventsMode: "none" });
    const failed = Object.values(results).some(
      (r) =>
        r &&
        typeof r === "object" &&
        "status" in r &&
        (r as { status: string }).status === "error" &&
        String((r as { error?: string }).error ?? "").includes(
          "Couldn’t save this source",
        ),
    );
    if (failed) {
      return NextResponse.json(
        { error: "Sync couldn’t be saved. Try again.", results, ledger },
        { status: 502 },
      );
    }
    return NextResponse.json({ results, ledger });
  } catch (err) {
    const message =
      err instanceof SyncRangeError
        ? err.message
        : err instanceof LedgerPersistError
          ? "Sync couldn’t be saved. Try again."
          : err instanceof Error
            ? err.message
            : "Sync failed";
    const status = err instanceof SyncRangeError ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
