import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { TRACKED_SYMBOLS } from "@/lib/prices/binance-klines";
import { loadLatestCloses } from "@/lib/prices/price-db";

/**
 * GET /api/prices
 * Latest closes from Postgres ohlcv for dashboard conversion.
 */
export async function GET() {
  const gate = await requireUser();
  if (gate.error) return gate.error;

  try {
    const symbols = [...TRACKED_SYMBOLS];
    const latest = await loadLatestCloses(symbols, "1m");
    const rates: Record<string, number> = {};
    const asOf: Record<string, string> = {};
    for (const [symbol, row] of Object.entries(latest)) {
      rates[symbol] = row.close;
      asOf[symbol] = row.openTime;
    }
    return NextResponse.json({
      rates,
      asOf,
      source: "binance",
      storedIn: "public.ohlcv",
      note: "USDT ≈ USD; EUR via EURUSDT. Missing symbols omit from rates.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Price load failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
