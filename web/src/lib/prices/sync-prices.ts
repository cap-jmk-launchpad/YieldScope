/**
 * Price sync orchestration: backfill + incremental minute updates into ohlcv.
 */

import {
  TRACKED_SYMBOLS,
  fetchKlines,
  fetchKlinesRange,
  INTERVAL_MS,
  type OhlcvInterval,
} from "@/lib/prices/binance-klines";
import {
  loadMaxOpenTime,
  upsertOhlcvCandles,
  PricePersistError,
} from "@/lib/prices/price-db";

export interface SyncPricesOptions {
  /** When true (or DB empty for a symbol), pull history windows below. */
  backfill?: boolean;
  /** Extra symbols beyond TRACKED_SYMBOLS (e.g. MONUSDT). */
  symbols?: string[];
  fetchImpl?: typeof fetch;
  /** Days of 1m history on backfill (default 7). */
  minuteLookbackDays?: number;
  /** Days of 1d history on backfill (default 730 ≈ 2y). */
  dailyLookbackDays?: number;
  /**
   * Pause between kline pages during backfill (default 80ms).
   * Tests should pass 0 to avoid timer/hang flakiness.
   */
  sleepMs?: number;
}

export interface SyncPricesResult {
  written: number;
  symbols: string[];
  errors: Array<{ symbol: string; interval: OhlcvInterval; error: string }>;
  mode: "incremental" | "backfill";
}

const DAY_MS = 86_400_000;

async function syncSymbolInterval(opts: {
  symbol: string;
  interval: OhlcvInterval;
  backfill: boolean;
  lookbackMs: number;
  fetchImpl?: typeof fetch;
  sleepMs?: number;
}): Promise<{ written: number; error?: string }> {
  try {
    const maxOpen = await loadMaxOpenTime(opts.symbol, opts.interval);
    const now = Date.now();
    let candles;

    if (!maxOpen || opts.backfill) {
      const startMs = now - opts.lookbackMs;
      candles = await fetchKlinesRange({
        symbol: opts.symbol,
        interval: opts.interval,
        startMs,
        endMs: now,
        fetchImpl: opts.fetchImpl,
        sleepMs: opts.sleepMs,
      });
    } else {
      // Incremental: from last candle (re-upsert last bar) through now
      const startMs = Math.max(
        0,
        Date.parse(maxOpen) - INTERVAL_MS[opts.interval],
      );
      candles = await fetchKlines({
        symbol: opts.symbol,
        interval: opts.interval,
        startMs,
        endMs: now,
        limit: opts.interval === "1m" ? 5 : 3,
        fetchImpl: opts.fetchImpl,
      });
    }

    const written = await upsertOhlcvCandles(candles);
    return { written };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Unknown symbol on Binance (e.g. MONUSDT) — soft-fail
    if (/HTTP 400|Invalid symbol/i.test(message)) {
      return { written: 0, error: message };
    }
    throw err;
  }
}

export async function syncPrices(
  opts: SyncPricesOptions = {},
): Promise<SyncPricesResult> {
  const symbols = [
    ...new Set([...(opts.symbols ?? []), ...TRACKED_SYMBOLS]),
  ];
  const backfill = Boolean(opts.backfill);
  const minuteLookback =
    (opts.minuteLookbackDays ?? 7) * DAY_MS;
  const dailyLookback = (opts.dailyLookbackDays ?? 730) * DAY_MS;

  let written = 0;
  const errors: SyncPricesResult["errors"] = [];

  for (const symbol of symbols) {
    for (const interval of ["1m", "1d"] as OhlcvInterval[]) {
      const lookbackMs = interval === "1m" ? minuteLookback : dailyLookback;
      try {
        // Auto-backfill when table has no rows for this pair
        const maxOpen = await loadMaxOpenTime(symbol, interval);
        const doBackfill = backfill || !maxOpen;
        const result = await syncSymbolInterval({
          symbol,
          interval,
          backfill: doBackfill,
          lookbackMs,
          fetchImpl: opts.fetchImpl,
        });
        written += result.written;
        if (result.error) {
          errors.push({ symbol, interval, error: result.error });
        }
      } catch (err) {
        const message =
          err instanceof PricePersistError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        errors.push({ symbol, interval, error: message });
      }
    }
  }

  return {
    written,
    symbols,
    errors,
    mode: backfill ? "backfill" : "incremental",
  };
}
