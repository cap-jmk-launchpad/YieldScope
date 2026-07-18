import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import type { OhlcvCandle, OhlcvInterval } from "@/lib/prices/binance-klines";

export class PricePersistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricePersistError";
  }
}

export interface OhlcvRow {
  symbol: string;
  interval: OhlcvInterval;
  open_time: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  source: string;
}

/** Upsert candles into public.ohlcv (service role). */
export async function upsertOhlcvCandles(
  candles: OhlcvCandle[],
): Promise<number> {
  if (candles.length === 0) return 0;
  if (!isAdminConfigured()) {
    throw new PricePersistError(
      "Database not configured — cannot persist prices (fail closed).",
    );
  }

  const admin = createAdminClient();
  const rows: OhlcvRow[] = candles.map((c) => ({
    symbol: c.symbol,
    interval: c.interval,
    open_time: c.openTime,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
    source: c.source,
  }));

  // Chunk to keep PostgREST payloads reasonable
  const chunkSize = 500;
  let written = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await admin.from("ohlcv").upsert(chunk, {
      onConflict: "symbol,interval,open_time,source",
    });
    if (error) {
      throw new PricePersistError(`ohlcv upsert failed: ${error.message}`);
    }
    written += chunk.length;
  }
  return written;
}

/** Latest close prices for the given symbols at interval (default 1m). */
export async function loadLatestCloses(
  symbols: string[],
  interval: OhlcvInterval = "1m",
): Promise<Record<string, { close: number; openTime: string }>> {
  if (!isAdminConfigured()) {
    throw new PricePersistError("Database not configured");
  }
  if (symbols.length === 0) return {};

  const admin = createAdminClient();
  const out: Record<string, { close: number; openTime: string }> = {};

  // Single batched read via ohlcv_latest (DISTINCT ON) — avoids N round-trips.
  const { data, error } = await admin
    .from("ohlcv_latest")
    .select("symbol, close, open_time")
    .in("symbol", symbols)
    .eq("interval", interval)
    .eq("source", "binance");
  if (error) {
    throw new PricePersistError(`ohlcv latest: ${error.message}`);
  }
  for (const row of data ?? []) {
    const symbol = String(row.symbol ?? "");
    if (!symbol || row.close == null || !row.open_time) continue;
    out[symbol] = {
      close: Number(row.close),
      openTime: row.open_time as string,
    };
  }

  // Fallback to 1d if 1m missing (cold start before minute job catches up)
  if (interval === "1m") {
    const missing = symbols.filter((s) => !out[s]);
    if (missing.length > 0) {
      const daily = await loadLatestCloses(missing, "1d");
      Object.assign(out, daily);
    }
  }

  return out;
}

/**
 * Close at or before `asOf` (for historical reward conversion).
 * Prefers 1m; falls back to 1d.
 */
export async function loadCloseAtOrBefore(
  symbol: string,
  asOf: string | Date,
): Promise<{ close: number; openTime: string; interval: OhlcvInterval } | null> {
  if (!isAdminConfigured()) {
    throw new PricePersistError("Database not configured");
  }
  const admin = createAdminClient();
  const asOfIso = typeof asOf === "string" ? asOf : asOf.toISOString();

  for (const interval of ["1m", "1d"] as OhlcvInterval[]) {
    const { data, error } = await admin
      .from("ohlcv")
      .select("close, open_time, interval")
      .eq("symbol", symbol)
      .eq("interval", interval)
      .eq("source", "binance")
      .lte("open_time", asOfIso)
      .order("open_time", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw new PricePersistError(
        `ohlcv at ${symbol} ${asOfIso}: ${error.message}`,
      );
    }
    if (data?.close != null && data.open_time) {
      return {
        close: Number(data.close),
        openTime: data.open_time as string,
        interval,
      };
    }
  }
  return null;
}

/** Max open_time for a symbol+interval (for incremental sync cursor). */
export async function loadMaxOpenTime(
  symbol: string,
  interval: OhlcvInterval,
): Promise<string | null> {
  if (!isAdminConfigured()) {
    throw new PricePersistError("Database not configured");
  }
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ohlcv")
    .select("open_time")
    .eq("symbol", symbol)
    .eq("interval", interval)
    .eq("source", "binance")
    .order("open_time", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new PricePersistError(`ohlcv max ${symbol}: ${error.message}`);
  }
  return (data?.open_time as string | undefined) ?? null;
}
