/**
 * Binance public market data as YieldScope price feed.
 *
 * Why Binance:
 * - Already used for earn adapters (same ecosystem)
 * - Public /api/v3/klines needs no API key
 * - Native 1m + 1d candles, EURUSDT for EUR↔USD proxy
 * - USDT quote ≈ USD for stable conversion
 *
 * Rate limits: weight-based; we paginate ≤1000 candles/request and sleep lightly between pages.
 */

export type OhlcvInterval = "1m" | "1d";

export interface OhlcvCandle {
  symbol: string;
  interval: OhlcvInterval;
  openTime: string; // ISO
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  source: "binance";
}

/** Symbols we keep warm for display FX + common earn assets. */
export const TRACKED_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "EURUSDT",
  "LUNCUSDT",
] as const;

export type TrackedSymbol = (typeof TRACKED_SYMBOLS)[number];

const BINANCE_KLINES = "https://api.binance.com/api/v3/klines";

/** Max candles Binance returns per request. */
export const KLINES_LIMIT = 1000;

type BinanceKline = [
  number, // open time ms
  string, // open
  string, // high
  string, // low
  string, // close
  string, // volume
  number, // close time
  ...unknown[],
];

export function parseKlines(
  symbol: string,
  interval: OhlcvInterval,
  raw: BinanceKline[],
): OhlcvCandle[] {
  return raw.map((row) => ({
    symbol,
    interval,
    openTime: new Date(row[0]).toISOString(),
    open: row[1],
    high: row[2],
    low: row[3],
    close: row[4],
    volume: row[5],
    source: "binance" as const,
  }));
}

export async function fetchKlines(opts: {
  symbol: string;
  interval: OhlcvInterval;
  startMs?: number;
  endMs?: number;
  limit?: number;
  fetchImpl?: typeof fetch;
}): Promise<OhlcvCandle[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const params = new URLSearchParams({
    symbol: opts.symbol,
    interval: opts.interval,
    limit: String(opts.limit ?? KLINES_LIMIT),
  });
  if (opts.startMs != null) params.set("startTime", String(opts.startMs));
  if (opts.endMs != null) params.set("endTime", String(opts.endMs));

  const res = await fetchImpl(`${BINANCE_KLINES}?${params}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Binance klines ${opts.symbol} ${opts.interval}: HTTP ${res.status} ${body.slice(0, 200)}`,
    );
  }
  const raw = (await res.json()) as BinanceKline[];
  if (!Array.isArray(raw)) {
    throw new Error(`Binance klines unexpected payload for ${opts.symbol}`);
  }
  return parseKlines(opts.symbol, opts.interval, raw);
}

/**
 * Walk forward from startMs until now (or endMs), collecting all candles.
 * Stops early if a page returns empty or a single candle that doesn't advance.
 */
export async function fetchKlinesRange(opts: {
  symbol: string;
  interval: OhlcvInterval;
  startMs: number;
  endMs?: number;
  fetchImpl?: typeof fetch;
  sleepMs?: number;
}): Promise<OhlcvCandle[]> {
  const endMs = opts.endMs ?? Date.now();
  const sleepMs = opts.sleepMs ?? 80;
  const out: OhlcvCandle[] = [];
  let cursor = opts.startMs;

  while (cursor < endMs) {
    const page = await fetchKlines({
      symbol: opts.symbol,
      interval: opts.interval,
      startMs: cursor,
      endMs,
      limit: KLINES_LIMIT,
      fetchImpl: opts.fetchImpl,
    });
    if (page.length === 0) break;
    out.push(...page);
    const lastOpen = Date.parse(page[page.length - 1]!.openTime);
    const next = lastOpen + 1;
    if (next <= cursor) break;
    cursor = next;
    if (page.length < KLINES_LIMIT) break;
    if (sleepMs > 0) await new Promise((r) => setTimeout(r, sleepMs));
  }

  return out;
}

/** Interval duration helpers for backfill windows. */
export const INTERVAL_MS: Record<OhlcvInterval, number> = {
  "1m": 60_000,
  "1d": 86_400_000,
};
