/**
 * Audit earn-event assets against USDT price coverage.
 *
 * Stables need no pair. Everything else maps to `{ASSET}USDT` via
 * assetToUsdtSymbol. "Missing" = needs a pair that is not in the known set
 * (TRACKED_SYMBOLS, ohlcv rates keys, or an explicit allow-list).
 */

import { assetToUsdtSymbol } from "@/lib/prices/convert";
import { TRACKED_SYMBOLS } from "@/lib/prices/binance-klines";

export interface PriceCoverageAudit {
  /** Unique normalized asset tickers from input. */
  assets: string[];
  /** Assets treated as 1:1 USDT/USD (no pair needed). */
  stables: string[];
  /** Assets with a USDT pair present in `knownPairs`. */
  covered: string[];
  /** Assets that need a pair but are absent from `knownPairs`. */
  missing: string[];
  /** USDT pairs required by non-stable assets (e.g. SOLUSDT). */
  pairsNeeded: string[];
  /** Subset of pairsNeeded not in knownPairs. */
  pairsMissing: string[];
}

function normalizeAsset(asset: string): string {
  return asset.trim().toUpperCase();
}

/** Distinct sorted assets from a list of tickers. */
export function uniqueAssets(assets: Iterable<string>): string[] {
  const set = new Set<string>();
  for (const a of assets) {
    const n = normalizeAsset(a);
    if (n) set.add(n);
  }
  return [...set].sort();
}

/**
 * Map earn assets → Binance USDT pairs (skips stables / empty).
 * Used by price sync to warm candles for imported ledger assets.
 */
export function usdtPairsForAssets(assets: Iterable<string>): string[] {
  const pairs = new Set<string>();
  for (const asset of uniqueAssets(assets)) {
    const pair = assetToUsdtSymbol(asset);
    if (pair) pairs.add(pair);
  }
  return [...pairs].sort();
}

/** Union of always-tracked pairs and pairs derived from earn assets. */
export function symbolsToTrack(assets: Iterable<string>): string[] {
  return [
    ...new Set([...TRACKED_SYMBOLS, ...usdtPairsForAssets(assets)]),
  ].sort();
}

/**
 * Compare imported asset tickers against a set of known USDT pair symbols
 * (TRACKED_SYMBOLS and/or keys present in ohlcv / RateMap).
 */
export function auditPriceCoverage(
  assets: Iterable<string>,
  knownPairs: Iterable<string> = TRACKED_SYMBOLS,
): PriceCoverageAudit {
  const known = new Set(
    [...knownPairs].map((s) => s.trim().toUpperCase()).filter(Boolean),
  );
  const all = uniqueAssets(assets);
  const stables: string[] = [];
  const covered: string[] = [];
  const missing: string[] = [];
  const pairsNeeded: string[] = [];
  const pairsMissing: string[] = [];

  for (const asset of all) {
    const pair = assetToUsdtSymbol(asset);
    if (!pair) {
      stables.push(asset);
      continue;
    }
    pairsNeeded.push(pair);
    if (known.has(pair)) {
      covered.push(asset);
    } else {
      missing.push(asset);
      pairsMissing.push(pair);
    }
  }

  return {
    assets: all,
    stables,
    covered,
    missing,
    pairsNeeded: [...new Set(pairsNeeded)].sort(),
    pairsMissing: [...new Set(pairsMissing)].sort(),
  };
}
