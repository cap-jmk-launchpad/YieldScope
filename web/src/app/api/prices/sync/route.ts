import { NextResponse } from "next/server";
import { syncPrices } from "@/lib/prices/sync-prices";
import { isAdminConfigured } from "@/lib/supabase/admin";

/**
 * POST /api/prices/sync
 * Called by k8s CronJob every minute (and one-shot backfill Job).
 * Auth: header x-price-sync-secret must match PRICE_SYNC_SECRET.
 */
export async function POST(req: Request) {
  const expected = process.env.PRICE_SYNC_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "PRICE_SYNC_SECRET not configured" },
      { status: 503 },
    );
  }
  const provided = req.headers.get("x-price-sync-secret");
  if (!provided || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdminConfigured()) {
    return NextResponse.json(
      { error: "Supabase admin not configured" },
      { status: 503 },
    );
  }

  let backfill = false;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      backfill?: boolean;
    };
    backfill = Boolean(body.backfill);
  } catch {
    backfill = false;
  }
  const url = new URL(req.url);
  if (url.searchParams.get("backfill") === "1") backfill = true;

  try {
    const result = await syncPrices({ backfill });
    return NextResponse.json({
      ok: true,
      ...result,
      rateSource:
        "Binance public /api/v3/klines (USDT quote; EUR via EURUSDT)",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Price sync failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
