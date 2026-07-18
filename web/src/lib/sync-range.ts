/**
 * Sync window: all available history, or an inclusive custom date range.
 *
 * ## Intended range semantics (FE ↔ DB ↔ display)
 *
 * | Source        | Sync behavior | Persist | Display |
 * |---------------|---------------|---------|---------|
 * | Binance / OKX | Fetch bounded to the selected window (or all-time / incremental) | Custom → merge-replace inside window (keep outside). All-time first/forceFull → replace. All-time later → upsert from high-water. | Full persisted ledger (no client date filter). |
 * | LUNC / Monad  | Point-in-time pending rewards — **range ignored** | Always full-replace snapshot | Always show current pending rows (`earnedAt` = sync time). |
 *
 * Date-only `YYYY-MM-DD` bounds are UTC day starts/ends. The picker is a
 * **sync** control, not a view filter: after sync, `/api/ledger` returns the
 * cumulative DB and the dashboard renders that set as-is.
 */

export type SyncRangeMode = "all" | "custom";

export interface SyncRange {
  mode: SyncRangeMode;
  /** Inclusive start — `YYYY-MM-DD` or ISO-8601 */
  from?: string;
  /** Inclusive end — `YYYY-MM-DD` or ISO-8601 */
  to?: string;
  /**
   * When true with mode "all", re-download full history and replace the source
   * ledger. Default false: subsequent "all time" syncs are incremental.
   */
  forceFull?: boolean;
}

export interface ResolvedSyncWindow {
  mode: SyncRangeMode;
  /** Inclusive start ms; null = unbounded (all-time) */
  fromMs: number | null;
  /** Inclusive end ms; null = unbounded (all-time) */
  toMs: number | null;
}

/** Sources that ignore the sync date range (pending snapshot only). */
export const POINT_IN_TIME_SOURCES = ["lunc_stake", "monad_stake"] as const;

export type PointInTimeSource = (typeof POINT_IN_TIME_SOURCES)[number];

export function isPointInTimeSource(source: string): source is PointInTimeSource {
  return (
    source === "lunc_stake" ||
    source === "monad_stake"
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Binance Simple Earn history rejects windows longer than 30 days. */
export const BINANCE_MAX_WINDOW_MS = 30 * DAY_MS;

/** How far back "all time" walks for CEX history (safety cap). */
export const ALL_TIME_LOOKBACK_MS = 5 * 365 * DAY_MS;

/**
 * Overlap when incrementally syncing from the last high-water mark so late
 * exchange rows near the cursor are not missed.
 */
export const INCREMENTAL_OVERLAP_MS = DAY_MS;

export class SyncRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncRangeError";
  }
}

function parseBound(value: string, endOfDay: boolean): number {
  const trimmed = value.trim();
  // Date-only → treat as UTC day bounds
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const ms = Date.parse(
      endOfDay ? `${trimmed}T23:59:59.999Z` : `${trimmed}T00:00:00.000Z`,
    );
    if (Number.isNaN(ms)) {
      throw new SyncRangeError(`Invalid date: ${value}`);
    }
    return ms;
  }
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) {
    throw new SyncRangeError(`Invalid date: ${value}`);
  }
  return ms;
}

/**
 * Resolve UI/API sync range into millisecond bounds.
 * `mode: "all"` → unbounded (adapters fetch full available history).
 */
export function resolveSyncRange(
  range?: SyncRange | null,
): ResolvedSyncWindow {
  if (!range || range.mode === "all") {
    return { mode: "all", fromMs: null, toMs: null };
  }

  if (!range.from || !range.to) {
    throw new SyncRangeError(
      "Custom sync range requires both from and to dates",
    );
  }

  const fromMs = parseBound(range.from, false);
  const toMs = parseBound(range.to, true);
  if (fromMs > toMs) {
    throw new SyncRangeError("Sync range from must be on or before to");
  }

  return { mode: "custom", fromMs, toMs };
}

export function eventInWindow(
  earnedAt: string,
  window: ResolvedSyncWindow,
): boolean {
  if (window.mode === "all") return true;
  const t = Date.parse(earnedAt);
  if (Number.isNaN(t)) return false;
  if (window.fromMs != null && t < window.fromMs) return false;
  if (window.toMs != null && t > window.toMs) return false;
  return true;
}

export function filterEventsByWindow<T extends { earnedAt: string }>(
  events: T[],
  window: ResolvedSyncWindow,
): T[] {
  if (window.mode === "all") return events;
  return events.filter((e) => eventInWindow(e.earnedAt, window));
}

/**
 * Split [fromMs, toMs] into ≤30-day chunks for Binance (newest first).
 */
export function chunkTimeRange(
  fromMs: number,
  toMs: number,
  maxSpanMs = BINANCE_MAX_WINDOW_MS,
): Array<{ startMs: number; endMs: number }> {
  if (fromMs > toMs) return [];
  const chunks: Array<{ startMs: number; endMs: number }> = [];
  let end = toMs;
  while (end >= fromMs) {
    const start = Math.max(fromMs, end - maxSpanMs + 1);
    chunks.push({ startMs: start, endMs: end });
    if (start <= fromMs) break;
    end = start - 1;
  }
  return chunks;
}

/** Default lookback window for Binance "all time" (newest → oldest chunks). */
export function allTimeBinanceChunks(nowMs = Date.now()): Array<{
  startMs: number;
  endMs: number;
}> {
  return chunkTimeRange(nowMs - ALL_TIME_LOOKBACK_MS, nowMs);
}

function parseForceFull(value: unknown): boolean {
  return value === true || value === "true" || value === 1;
}

/**
 * Build the sync `range` object the dashboard POSTs to `/api/sync`.
 * Keeps FE → API body shape in one place for tests.
 */
export function buildSyncRangeFromUi(
  mode: SyncRangeMode,
  from: string,
  to: string,
  forceFull = false,
): SyncRange {
  if (mode === "all") {
    return forceFull ? { mode: "all", forceFull: true } : { mode: "all" };
  }
  return { mode: "custom", from, to };
}

/**
 * True when every CEX event lies inside `window`. Point-in-time sources are
 * skipped (they are allowed outside the sync window).
 */
export function cexEventsMatchWindow<
  T extends { earnedAt: string; source: string },
>(events: T[], window: ResolvedSyncWindow): boolean {
  for (const e of events) {
    if (isPointInTimeSource(e.source)) continue;
    if (!eventInWindow(e.earnedAt, window)) return false;
  }
  return true;
}

/**
 * Display = full ledger. Sync range is not applied as a client view filter.
 * Exported so tests lock FE/DB/display agreement on this contract.
 */
export function ledgerEventsForDisplay<T>(events: T[]): T[] {
  return events;
}

/**
 * Detect suspiciously short CEX coverage (e.g. old 500-row truncation) so the
 * UI can nudge a full-history re-download.
 */
export function cexCoverageRefreshHint(
  events: Array<{ source: string; earnedAt: string }>,
): string | null {
  const cex = events.filter(
    (e) => e.source === "binance" || e.source === "okx",
  );
  if (cex.length < 50) return null;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
    for (const e of cex) {
      const t = Date.parse(e.earnedAt);
      if (!Number.isFinite(t)) continue;
      if (t < min) min = t;
      if (t > max) max = t;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  const spanDays = (max - min) / DAY_MS;
  if (spanDays <= 3) {
    return "Exchange history only spans a few days in the ledger. Use “Re-download full history” or sync a wider Date range.";
  }
  return null;
}

export function parseSyncRangeBody(
  body: unknown,
): SyncRange | undefined {
  if (!body || typeof body !== "object") return undefined;
  const r = body as Record<string, unknown>;
  const bodyForce = parseForceFull(r.forceFull ?? r.forceFullRefresh);

  if (r.range == null) {
    // Flat from/to + optional mode on the body itself
    if (r.mode === "all" || (r.from == null && r.to == null && r.mode == null)) {
      if (r.mode === "all") {
        return bodyForce ? { mode: "all", forceFull: true } : { mode: "all" };
      }
      // mode omitted and both bounds omitted → optional all-time / forceFull
      return bodyForce ? { mode: "all", forceFull: true } : undefined;
    }
    if (typeof r.from === "string" || typeof r.to === "string") {
      return {
        mode: "custom",
        from: typeof r.from === "string" ? r.from : undefined,
        to: typeof r.to === "string" ? r.to : undefined,
      };
    }
    return undefined;
  }
  if (typeof r.range !== "object" || r.range === null) {
    throw new SyncRangeError("Invalid range payload");
  }
  const range = r.range as Record<string, unknown>;
  const mode = range.mode === "custom" ? "custom" : "all";
  const forceFull =
    parseForceFull(range.forceFull) || bodyForce;
  if (mode === "all") {
    return forceFull ? { mode: "all", forceFull: true } : { mode: "all" };
  }
  return {
    mode: "custom",
    from: typeof range.from === "string" ? range.from : undefined,
    to: typeof range.to === "string" ? range.to : undefined,
  };
}
