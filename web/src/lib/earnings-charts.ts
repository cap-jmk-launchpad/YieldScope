/**
 * Pure aggregations for dashboard earnings charts.
 *
 * Amounts are native asset strings on EarnEvent. Cross-asset totals only make
 * sense once a display-currency converter is provided (EUR/USD/BTC/ETH selector).
 * Without `convertAmount`, native amounts are summed with exact decimal-string
 * math so dust rewards accumulate correctly before a final Number() for charts.
 */

import {
  addDecimalStrings,
  decimalToNumber,
  isZeroDecimal,
  sumDecimalStrings,
} from "./decimal-amount";

export interface ChartEarnEvent {
  asset: string;
  amount: string;
  /** ISO-8601 */
  earnedAt: string;
}

/** Hook for a future display-currency selector — convert native → display units. */
export type ConvertAmount = (asset: string, amount: string) => number;

export interface EarningsChartOptions {
  /** Convert native asset amount into a single display unit. Default: Number(amount). */
  convertAmount?: ConvertAmount;
  /** Axis / tooltip label when converted (e.g. "USD"). Default: "native". */
  displayCurrency?: string;
}

export interface TimePoint {
  /** Bucket start ISO date (UTC day) */
  date: string;
  /** Period earnings in this bucket (display units) */
  period: number;
  /** Running cumulative total through this bucket */
  cumulative: number;
}

export interface YearPoint {
  year: number;
  total: number;
}

export interface CurrencySlice {
  asset: string;
  total: number;
  /** Share of grand total in [0, 1]; 0 when empty */
  share: number;
}

export function defaultConvertAmount(_asset: string, amount: string): number {
  return decimalToNumber(amount) ?? 0;
}

function resolveConvert(opts?: EarningsChartOptions): ConvertAmount | null {
  return opts?.convertAmount ?? null;
}

function displayUnit(opts?: EarningsChartOptions): string {
  return opts?.displayCurrency?.trim() || "native";
}

function utcDayKey(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function utcYear(iso: string): number | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).getUTCFullYear();
}

function toChartNumber(decimalSum: string): number {
  const n = decimalToNumber(decimalSum);
  return n == null || !Number.isFinite(n) ? 0 : n;
}

/**
 * Daily period + cumulative earnings over time (UTC days), sorted ascending.
 * Invalid dates / non-finite amounts are skipped.
 * Native (no convertAmount) path sums with exact decimal strings.
 */
export function earningsOverTime(
  events: ChartEarnEvent[],
  opts?: EarningsChartOptions,
): TimePoint[] {
  const convert = resolveConvert(opts);

  if (!convert) {
    const byDay = new Map<string, string>();
    for (const e of events) {
      const day = utcDayKey(e.earnedAt);
      if (!day || isZeroDecimal(e.amount)) continue;
      try {
        byDay.set(day, addDecimalStrings(byDay.get(day) ?? "0", e.amount));
      } catch {
        /* skip malformed */
      }
    }
    const days = [...byDay.keys()].sort();
    let cumulativeDec = "0";
    return days.map((date) => {
      const periodDec = byDay.get(date) ?? "0";
      cumulativeDec = addDecimalStrings(cumulativeDec, periodDec);
      return {
        date,
        period: toChartNumber(periodDec),
        cumulative: toChartNumber(cumulativeDec),
      };
    });
  }

  const byDay = new Map<string, number>();
  for (const e of events) {
    const day = utcDayKey(e.earnedAt);
    if (!day) continue;
    const value = convert(e.asset, e.amount);
    if (!Number.isFinite(value) || value === 0) continue;
    byDay.set(day, (byDay.get(day) ?? 0) + value);
  }

  const days = [...byDay.keys()].sort();
  let cumulative = 0;
  return days.map((date) => {
    const period = byDay.get(date) ?? 0;
    cumulative += period;
    return { date, period, cumulative };
  });
}

/** Calendar-year totals (UTC), sorted ascending by year. */
export function earningsByYear(
  events: ChartEarnEvent[],
  opts?: EarningsChartOptions,
): YearPoint[] {
  const convert = resolveConvert(opts);

  if (!convert) {
    const byYear = new Map<number, string>();
    for (const e of events) {
      const year = utcYear(e.earnedAt);
      if (year == null || isZeroDecimal(e.amount)) continue;
      try {
        byYear.set(year, addDecimalStrings(byYear.get(year) ?? "0", e.amount));
      } catch {
        /* skip malformed */
      }
    }
    return [...byYear.entries()]
      .sort(([a], [b]) => a - b)
      .map(([year, total]) => ({ year, total: toChartNumber(total) }));
  }

  const byYear = new Map<number, number>();
  for (const e of events) {
    const year = utcYear(e.earnedAt);
    if (year == null) continue;
    const value = convert(e.asset, e.amount);
    if (!Number.isFinite(value)) continue;
    byYear.set(year, (byYear.get(year) ?? 0) + value);
  }

  return [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, total]) => ({ year, total }));
}

/**
 * Asset / currency breakdown for a pie chart.
 * Slices sorted by total descending; assets with zero/non-finite totals omitted.
 */
export function earningsByCurrency(
  events: ChartEarnEvent[],
  opts?: EarningsChartOptions,
): CurrencySlice[] {
  const convert = resolveConvert(opts);

  if (!convert) {
    const byAsset = new Map<string, string>();
    for (const e of events) {
      const asset = e.asset.trim() || "UNKNOWN";
      if (isZeroDecimal(e.amount)) continue;
      try {
        byAsset.set(asset, addDecimalStrings(byAsset.get(asset) ?? "0", e.amount));
      } catch {
        /* skip malformed */
      }
    }
    const slices = [...byAsset.entries()]
      .map(([asset, totalDec]) => ({
        asset,
        total: toChartNumber(totalDec),
        share: 0,
      }))
      .filter((s) => s.total !== 0)
      .sort((a, b) => b.total - a.total || a.asset.localeCompare(b.asset));

    const grandDec = sumDecimalStrings(
      [...byAsset.entries()]
        .filter(([, t]) => !isZeroDecimal(t))
        .map(([, t]) => t),
    );
    const grand = toChartNumber(grandDec);
    if (grand > 0) {
      for (const slice of slices) {
        slice.share = slice.total / grand;
      }
    }
    return slices;
  }

  const byAsset = new Map<string, number>();
  for (const e of events) {
    const asset = e.asset.trim() || "UNKNOWN";
    const value = convert(asset, e.amount);
    if (!Number.isFinite(value) || value === 0) continue;
    byAsset.set(asset, (byAsset.get(asset) ?? 0) + value);
  }

  const slices = [...byAsset.entries()]
    .map(([asset, total]) => ({ asset, total, share: 0 }))
    .sort((a, b) => b.total - a.total || a.asset.localeCompare(b.asset));

  const grand = slices.reduce((s, x) => s + x.total, 0);
  if (grand > 0) {
    for (const slice of slices) {
      slice.share = slice.total / grand;
    }
  }
  return slices;
}

export function chartDisplayUnit(opts?: EarningsChartOptions): string {
  return displayUnit(opts);
}

/** True when charts have nothing meaningful to render. */
export function hasChartData(events: ChartEarnEvent[]): boolean {
  return events.some((e) => {
    try {
      return (
        !isZeroDecimal(e.amount) && !Number.isNaN(Date.parse(e.earnedAt))
      );
    } catch {
      return false;
    }
  });
}
