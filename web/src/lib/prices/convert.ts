/**
 * Display-currency conversion using USDT-quoted rates from ohlcv.
 *
 * Path: asset → USDT → display (USD | EUR | BTC | ETH)
 * Stablecoins (USDT/USDC/…/USD) are treated as 1 USDT.
 * Missing rates → null (caller shows native amount).
 */

export type DisplayCurrency = "USD" | "EUR" | "BTC" | "ETH";

export const DISPLAY_CURRENCIES: DisplayCurrency[] = [
  "USD",
  "EUR",
  "BTC",
  "ETH",
];

export const DISPLAY_CURRENCY_STORAGE_KEY = "yieldscope.displayCurrency";

/** Assets whose unit ≈ 1 USDT / USD. */
const STABLE_ASSETS = new Set([
  "USDT",
  "USDC",
  "USD",
  "BUSD",
  "FDUSD",
  "TUSD",
  "DAI",
  "USDE",
]);

/** Map earn asset ticker → Binance USDT pair (or null if synthetic stable). */
export function assetToUsdtSymbol(asset: string): string | null {
  const a = asset.trim().toUpperCase();
  if (STABLE_ASSETS.has(a)) return null; // 1:1
  if (a === "EUR") return "EURUSDT";
  return `${a}USDT`;
}

export type RateMap = Record<string, number>;

export function parseDisplayCurrency(
  raw: string | null | undefined,
): DisplayCurrency {
  const v = (raw ?? "").trim().toUpperCase();
  if (v === "EUR" || v === "BTC" || v === "ETH" || v === "USD") return v;
  return "USD";
}

export function loadDisplayCurrencyFromStorage(
  storage: Pick<Storage, "getItem"> | null | undefined,
): DisplayCurrency {
  if (!storage) return "USD";
  try {
    return parseDisplayCurrency(storage.getItem(DISPLAY_CURRENCY_STORAGE_KEY));
  } catch {
    return "USD";
  }
}

export function saveDisplayCurrencyToStorage(
  currency: DisplayCurrency,
  storage: Pick<Storage, "setItem"> | null | undefined,
): void {
  if (!storage) return;
  try {
    storage.setItem(DISPLAY_CURRENCY_STORAGE_KEY, currency);
  } catch {
    /* ignore quota / private mode */
  }
}

/** Convert native asset amount → USDT using rate map (symbol → close). */
export function toUsdt(
  amount: number,
  asset: string,
  rates: RateMap,
): number | null {
  if (!Number.isFinite(amount)) return null;
  const a = asset.trim().toUpperCase();
  if (STABLE_ASSETS.has(a)) return amount;

  const symbol = assetToUsdtSymbol(a);
  if (!symbol) return null;
  const px = rates[symbol];
  if (px == null || !(px > 0)) return null;
  return amount * px;
}

/** Convert a USDT value into the selected display currency. */
export function fromUsdt(
  usdt: number,
  currency: DisplayCurrency,
  rates: RateMap,
): number | null {
  if (!Number.isFinite(usdt)) return null;
  if (currency === "USD") return usdt;

  const pair =
    currency === "EUR"
      ? "EURUSDT"
      : currency === "BTC"
        ? "BTCUSDT"
        : "ETHUSDT";
  const px = rates[pair];
  if (px == null || !(px > 0)) return null;
  return usdt / px;
}

export function convertAmount(
  amount: number,
  asset: string,
  currency: DisplayCurrency,
  rates: RateMap,
): number | null {
  const usdt = toUsdt(amount, asset, rates);
  if (usdt == null) return null;
  return fromUsdt(usdt, currency, rates);
}

export interface AssetTotal {
  asset: string;
  source?: string;
  totalAmount: string | number;
  eventCount?: number;
}

export interface ConvertedSum {
  /** Sum in display currency (null if nothing convertible). */
  total: number | null;
  /** How many rows converted successfully. */
  convertedCount: number;
  /** Rows skipped due to missing rates. */
  skippedAssets: string[];
  currency: DisplayCurrency;
}

/** Sum by-asset aggregates into one display-currency total. */
export function sumInDisplayCurrency(
  rows: AssetTotal[],
  currency: DisplayCurrency,
  rates: RateMap,
): ConvertedSum {
  let total = 0;
  let convertedCount = 0;
  const skipped = new Set<string>();
  let any = false;

  for (const row of rows) {
    const native = Number(row.totalAmount);
    const converted = convertAmount(native, row.asset, currency, rates);
    if (converted == null) {
      skipped.add(row.asset.toUpperCase());
      continue;
    }
    total += converted;
    convertedCount += 1;
    any = true;
  }

  return {
    total: any ? total : null,
    convertedCount,
    skippedAssets: [...skipped].sort(),
    currency,
  };
}

/** Format a converted amount for UI. */
export function formatDisplayAmount(
  value: number | null,
  currency: DisplayCurrency,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (currency === "USD" || currency === "EUR") {
    const symbol = currency === "EUR" ? "€" : "$";
    return `${symbol}${value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  // BTC / ETH — more precision for small reward sums
  return `${value.toPrecision(6)} ${currency}`;
}
