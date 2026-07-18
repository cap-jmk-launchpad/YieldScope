import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { loadDbLedger } from "@/lib/ledger-db";
import { TRACKED_SYMBOLS } from "@/lib/prices/binance-klines";
import {
  auditPriceCoverage,
  symbolsToTrack,
} from "@/lib/prices/missing-symbols";
import { loadLatestCloses } from "@/lib/prices/price-db";

/**
 * GET /api/prices
 * Latest closes from Postgres ohlcv for dashboard conversion.
 * Includes TRACKED_SYMBOLS plus USDT pairs for the user's imported earn assets.
 */
export async function GET() {
  const gate = await requireUser();
  if (gate.error) return gate.error;

  try {
    let userAssets: string[] = [];
    try {
      const ledger = await loadDbLedger(gate.user.id);
      userAssets = (ledger.aggregates.byAsset ?? []).map((a) => a.asset);
    } catch {
      userAssets = [];
    }

    const symbols = symbolsToTrack(userAssets);
    const latest = await loadLatestCloses(symbols, "1m");
    const rates: Record<string, number> = {};
    const asOf: Record<string, string> = {};
    for (const [symbol, row] of Object.entries(latest)) {
      rates[symbol] = row.close;
      asOf[symbol] = row.openTime;
    }

    const audit = auditPriceCoverage(userAssets, [
      ...TRACKED_SYMBOLS,
      ...Object.keys(rates),
    ]);

    return NextResponse.json({
      rates,
      asOf,
      source: "binance",
      storedIn: "public.ohlcv",
      symbols,
      missingAssets: audit.missing,
      note: "USDT ≈ USD; EUR via EURUSDT. Missing symbols omit from rates.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Price load failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
