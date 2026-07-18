"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { CurrencyCell, CurrencyLogo } from "@/components/asset-icon";
import { EarningsCharts } from "@/components/earnings-charts";
import { TablePager } from "@/components/table-pager";
import type { EarnEvent, SourceId, SourceStatus } from "@/lib/adapters/types";
import type { ConvertAmount } from "@/lib/earnings-charts";
import {
  auditPriceCoverage,
} from "@/lib/prices/missing-symbols";
import type { SyncRange, SyncRangeMode } from "@/lib/sync-range";
import {
  buildSyncRangeFromUi,
  cexCoverageRefreshHintFromAggregates,
  ledgerEventsForDisplay,
  resolveSyncRange,
  syncRangesForSource,
} from "@/lib/sync-range";
import {
  clearSyncSession,
  formatSyncingOverview,
  isSyncSessionFresh,
  readSyncSession,
  resolveUiSourceStatus,
  sourceErrorForDisplay,
  sourcesForSyncTarget,
  UI_STATUS_LABEL,
  writeSyncSession,
  type UiSourceStatus,
} from "@/lib/sync-status";
import {
  DEFAULT_PAGE_SIZE,
  loadPageSizeFromStorage,
  paginateItems,
  parsePageSize,
  savePageSizeToStorage,
  totalPagesFor,
  clampPage,
  type PageSizeOption,
} from "@/lib/table-pagination";
import {
  DISPLAY_CURRENCIES,
  type DisplayCurrency,
  formatDisplayAmount,
  loadDisplayCurrencyFromStorage,
  parseDisplayCurrency,
  saveDisplayCurrencyToStorage,
  convertAmount as convertNative,
  sumInDisplayCurrency,
  type RateMap,
} from "@/lib/prices/convert";

interface LedgerResponse {
  events: EarnEvent[];
  eventsTotal?: number;
  eventsMode?: string;
  eventsPage?: number;
  eventsPageSize?: number;
  sources: Record<
    SourceId,
    { status: SourceStatus; error?: string; eventCount: number; lastSyncedAt?: string }
  >;
  aggregates?: {
    bySource: Array<{
      source: SourceId;
      eventCount: number;
      totalAmount: string;
      firstEarnedAt?: string | null;
      lastEarnedAt: string | null;
    }>;
    byAsset: Array<{
      asset: string;
      source: SourceId;
      eventCount: number;
      totalAmount: string;
    }>;
  };
  wallet?: { address: string; chainId: number; lastSeenAt: string } | null;
  updatedAt: string;
  error?: string;
}

const SOURCE_LABEL: Record<SourceId, string> = {
  binance: "Binance",
  okx: "OKX",
  monad_stake: "Monad stake",
  lunc_stake: "LUNC stake",
};

const SYNC_RANGE_KEY = "yieldscope.syncRange";

function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Calendar month-to-date in the user's local timezone (matches `<input type="date">`). */
function defaultMonthBounds(): { from: string; to: string } {
  const now = new Date();
  const to = formatLocalYmd(now);
  const from = formatLocalYmd(new Date(now.getFullYear(), now.getMonth(), 1));
  return { from, to };
}

function loadSavedRange(): {
  mode: SyncRangeMode;
  from: string;
  to: string;
} {
  const defaults = defaultMonthBounds();
  if (typeof window === "undefined") {
    return { mode: "all", ...defaults };
  }
  try {
    const raw = localStorage.getItem(SYNC_RANGE_KEY);
    if (!raw) return { mode: "all", ...defaults };
    const parsed = JSON.parse(raw) as {
      mode?: SyncRangeMode;
      from?: string;
      to?: string;
    };
    return {
      mode: parsed.mode === "custom" ? "custom" : "all",
      from:
        typeof parsed.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.from)
          ? parsed.from
          : defaults.from,
      to:
        typeof parsed.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.to)
          ? parsed.to
          : defaults.to,
    };
  } catch {
    return { mode: "all", ...defaults };
  }
}

/**
 * Optional overrides (tests / embedding). Live app loads rates from /api/prices
 * and preference from localStorage.
 */
export type DashboardDisplayCurrency = {
  displayCurrency?: string;
  convertAmount?: ConvertAmount;
};

export function Dashboard({
  displayCurrency: displayCurrencyProp,
  convertAmount: convertAmountProp,
}: DashboardDisplayCurrency = {}) {
  const [ledger, setLedger] = useState<LedgerResponse | null>(null);
  const [chartEvents, setChartEvents] = useState<EarnEvent[]>([]);
  const [chartsLoading, setChartsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [syncingSources, setSyncingSources] = useState<SourceId[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [rangeMode, setRangeMode] = useState<SyncRangeMode>("all");
  const [forceFullRefresh, setForceFullRefresh] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [currency, setCurrency] = useState<DisplayCurrency>("USD");
  const [rates, setRates] = useState<RateMap>({});
  const [ratesNote, setRatesNote] = useState<string | null>(null);
  const [missingAssets, setMissingAssets] = useState<string[]>([]);
  const [eventsPage, setEventsPage] = useState(1);
  const [assetsPage, setAssetsPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSizeOption>(DEFAULT_PAGE_SIZE);
  const [pageSizeReady, setPageSizeReady] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(false);
  const syncGen = useRef(0);
  const eventsFetchGen = useRef(0);
  const { address, chainId } = useAccount();

  useEffect(() => {
    const saved = loadSavedRange();
    setRangeMode(saved.mode);
    setFromDate(saved.from);
    setToDate(saved.to);
    setCurrency(loadDisplayCurrencyFromStorage(window.localStorage));
    setPageSize(loadPageSizeFromStorage(window.localStorage));
    setPageSizeReady(true);
  }, []);

  useEffect(() => {
    if (!fromDate || !toDate) return;
    try {
      localStorage.setItem(
        SYNC_RANGE_KEY,
        JSON.stringify({ mode: rangeMode, from: fromDate, to: toDate }),
      );
    } catch {
      /* ignore quota */
    }
  }, [rangeMode, fromDate, toDate]);

  useEffect(() => {
    if (displayCurrencyProp) return;
    saveDisplayCurrencyToStorage(currency, window.localStorage);
  }, [currency, displayCurrencyProp]);

  useEffect(() => {
    if (!pageSizeReady) return;
    savePageSizeToStorage(pageSize, window.localStorage);
  }, [pageSize, pageSizeReady]);

  const refreshRates = useCallback(async () => {
    try {
      const res = await fetch("/api/prices");
      const json = (await res.json()) as {
        rates?: RateMap;
        error?: string;
        note?: string;
        missingAssets?: string[];
      };
      if (!res.ok) {
        setRatesNote(json.error ?? "Price rates unavailable");
        return;
      }
      setRates(json.rates ?? {});
      setMissingAssets(
        Array.isArray(json.missingAssets) ? json.missingAssets : [],
      );
      setRatesNote(
        Object.keys(json.rates ?? {}).length === 0
          ? "Prices aren’t ready yet — amounts may show in native units for a moment."
          : null,
      );
    } catch (err) {
      setRatesNote(err instanceof Error ? err.message : "Couldn’t load prices");
    }
  }, []);

  const refreshCharts = useCallback(async () => {
    setChartsLoading(true);
    try {
      const res = await fetch("/api/ledger?eventsMode=chart");
      const json = (await res.json()) as LedgerResponse;
      if (res.ok) {
        setChartEvents(json.events ?? []);
      }
    } catch {
      /* charts are best-effort; table/totals already work from aggregates */
    } finally {
      setChartsLoading(false);
    }
  }, []);

  const fetchEventsPage = useCallback(
    async (page: number, size: PageSizeOption) => {
      const gen = ++eventsFetchGen.current;
      setEventsLoading(true);
      try {
        const qs = new URLSearchParams({
          eventsMode: "page",
          eventsPage: String(page),
          eventsPageSize: String(size),
        });
        const res = await fetch(`/api/ledger?${qs}`);
        const json = (await res.json()) as LedgerResponse;
        if (gen !== eventsFetchGen.current) return;
        if (!res.ok) {
          setMessage(json.error ?? "Failed to load ledger");
          return;
        }
        setLedger(json);
      } catch (err) {
        if (gen !== eventsFetchGen.current) return;
        setMessage(err instanceof Error ? err.message : "Failed to load ledger");
      } finally {
        if (gen === eventsFetchGen.current) setEventsLoading(false);
      }
    },
    [],
  );

  const handleEventsPageChange = useCallback(
    (page: number) => {
      setEventsPage(page);
      void fetchEventsPage(page, pageSize);
    },
    [fetchEventsPage, pageSize],
  );

  // Re-bind page-size handler now that fetchEventsPage exists.
  const handlePageSizeChange = useCallback(
    (size: PageSizeOption) => {
      const next = parsePageSize(size);
      setPageSize(next);
      setEventsPage(1);
      setAssetsPage(1);
      void fetchEventsPage(1, next);
    },
    [fetchEventsPage],
  );

  const pageSizeRef = useRef(pageSize);
  pageSizeRef.current = pageSize;

  const refresh = useCallback(async () => {
    const size = pageSizeRef.current;
    const qs = new URLSearchParams({
      eventsMode: "page",
      eventsPage: "1",
      eventsPageSize: String(size),
    });
    const res = await fetch(`/api/ledger?${qs}`);
    const json = (await res.json()) as LedgerResponse;
    setLedger(json);
    setEventsPage(1);
    setAssetsPage(1);
    if (!res.ok) {
      setMessage(json.error ?? "Failed to load ledger");
    } else {
      void refreshCharts();
    }
  }, [refreshCharts]);

  // Initial load once localStorage page size is ready (avoids a 25→saved double fetch).
  useEffect(() => {
    if (!pageSizeReady) return;
    void refresh();
    void refreshRates();
  }, [pageSizeReady, refresh, refreshRates]);

  // Recover visible sync state after refresh / navigation mid-sync.
  useEffect(() => {
    if (!pageSizeReady) return;
    const session = readSyncSession();
    if (!session || !isSyncSessionFresh(session)) {
      clearSyncSession();
      return;
    }
    if (session.pending.length === 0) {
      clearSyncSession();
      return;
    }
    setBusy(true);
    setSyncingSources(session.pending);
    setMessage(
      formatSyncingOverview(session.pending) ??
        "A sync was still running — refreshing…",
    );
    void (async () => {
      await refresh();
      clearSyncSession();
      setBusy(false);
      setSyncingSources([]);
      setMessage("Synced status refreshed.");
    })();
  }, [pageSizeReady, refresh]);

  async function syncOneSource(
    source: SourceId,
    range: SyncRange,
    gen: number,
  ): Promise<{ status?: string; error?: string } | null> {
    const body: Record<string, unknown> = {
      source,
      chainId: chainId ?? 10143,
      range,
      ...(range.mode === "all" && forceFullRefresh ? { forceFull: true } : {}),
    };
    if (address) body.address = address;

    let res: Response;
    try {
      res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      return {
        status: "error",
        error:
          "Sync request failed (network or timeout). Try a shorter date range or retry.",
      };
    }

    let json: {
      ledger?: LedgerResponse;
      results?: Record<string, { status?: string; error?: string }>;
      error?: string;
    };
    try {
      json = (await res.json()) as typeof json;
    } catch {
      return {
        status: "error",
        error: res.ok
          ? "Sync returned an unreadable response. Try again."
          : `Sync failed (HTTP ${res.status}). The window may be too large — try again or narrow the dates.`,
      };
    }

    if (gen !== syncGen.current) return null;

    if (json.ledger) {
      // Sync returns aggregates/sources only — keep the current events page.
      setLedger((prev) => ({
        ...json.ledger!,
        events: prev?.events ?? [],
        eventsTotal:
          json.ledger!.eventsTotal ??
          prev?.eventsTotal ??
          prev?.events?.length ??
          0,
        eventsMode: prev?.eventsMode ?? "page",
        eventsPage: prev?.eventsPage,
        eventsPageSize: prev?.eventsPageSize,
      }));
    }

    const result = json.results?.[source] ?? null;
    if (!res.ok && !result) {
      return {
        status: "error",
        error: json.error ?? "Sync failed. Nothing was saved — try again.",
      };
    }
    return result;
  }

  async function runSync(target: "all" | SourceId = "all") {
    const gen = ++syncGen.current;
    const targets = sourcesForSyncTarget(target);

    const range: SyncRange =
      rangeMode === "all"
        ? buildSyncRangeFromUi("all", fromDate, toDate, forceFullRefresh)
        : buildSyncRangeFromUi("custom", fromDate, toDate);

    if (range.mode === "custom" && (!range.from || !range.to)) {
      setMessage("Pick both from and to dates, or choose All time.");
      return;
    }

    setBusy(true);
    setMessage(formatSyncingOverview(targets));
    setSyncingSources(targets);
    writeSyncSession({
      startedAt: new Date().toISOString(),
      sources: targets,
      pending: targets,
    });

    // Optimistic: clear stale errors on sources about to sync.
    setLedger((prev) => {
      if (!prev) return prev;
      const sources = { ...prev.sources };
      for (const id of targets) {
        const cur = sources[id] ?? {
          status: "not_connected" as SourceStatus,
          eventCount: 0,
        };
        sources[id] = {
          ...cur,
          error: undefined,
        };
      }
      return { ...prev, sources };
    });

    const sourceErrors: string[] = [];
    let pending = [...targets];

    try {
      for (const src of targets) {
        if (gen !== syncGen.current) return;

        const ranges = syncRangesForSource(src, range);
        let result: { status?: string; error?: string } | null = null;
        for (let i = 0; i < ranges.length; i += 1) {
          if (gen !== syncGen.current) return;
          if (ranges.length > 1) {
            setMessage(
              `Syncing ${SOURCE_LABEL[src]} (${i + 1}/${ranges.length})…`,
            );
          }
          result = await syncOneSource(src, ranges[i], gen);
          if (result?.status === "error") break;
        }
        if (gen !== syncGen.current) return;

        pending = pending.filter((s) => s !== src);
        setSyncingSources(pending);
        writeSyncSession({
          startedAt: new Date().toISOString(),
          sources: targets,
          pending,
        });
        setMessage(formatSyncingOverview(pending) ?? null);

        if (result?.status === "error" && result.error) {
          sourceErrors.push(`${SOURCE_LABEL[src]}: ${result.error}`);
        }
      }

      if (gen !== syncGen.current) return;

      const modeLabel =
        range.mode === "all"
          ? forceFullRefresh
            ? "all time · full history"
            : "all time"
          : `${range.from} → ${range.to} (CEX)`;

      if (sourceErrors.length > 0) {
        setMessage(
          `Sync finished with errors (${modeLabel}). LUNC/Monad refresh pending only. ${sourceErrors.join(" · ")}`,
        );
      } else {
        setMessage(
          `Sync finished (${modeLabel}). LUNC/Monad store current pending rewards only.`,
        );
      }
      if (forceFullRefresh) setForceFullRefresh(false);
      await refresh();
      void refreshRates();
    } catch (err) {
      if (gen !== syncGen.current) return;
      setMessage(err instanceof Error ? err.message : "Sync failed");
    } finally {
      if (gen === syncGen.current) {
        setBusy(false);
        setSyncingSources([]);
        clearSyncSession();
      }
    }
  }

  const activeCurrency: DisplayCurrency = displayCurrencyProp
    ? parseDisplayCurrency(displayCurrencyProp)
    : currency;

  const convertAmount: ConvertAmount = useMemo(() => {
    if (convertAmountProp) return convertAmountProp;
    return (asset, amount) => {
      const native = Number(amount);
      if (!Number.isFinite(native)) return 0;
      // No ticks yet → plot native so charts aren't blank while prices warm up.
      if (Object.keys(rates).length === 0) return native;
      return convertNative(native, asset, activeCurrency, rates) ?? 0;
    };
  }, [convertAmountProp, activeCurrency, rates]);

  const chartDisplayCurrency =
    convertAmountProp || Object.keys(rates).length > 0
      ? activeCurrency
      : undefined;

  const totalLabel = summarizeFromAggregates(
    ledger,
    activeCurrency,
    rates,
    Boolean(convertAmountProp),
  );
  const customDisabled = rangeMode !== "custom";
  const syncOverview = formatSyncingOverview(syncingSources);

  const byAssetRows = ledger?.aggregates?.byAsset ?? [];
  // Server already returns the current events page (not the full history).
  const eventRows = ledgerEventsForDisplay(ledger?.events ?? []);
  const eventsTotal =
    ledger?.eventsTotal ??
    (ledger?.aggregates?.bySource ?? []).reduce(
      (sum, row) => sum + row.eventCount,
      0,
    );

  const coverageHint = useMemo(
    () =>
      cexCoverageRefreshHintFromAggregates(ledger?.aggregates?.bySource ?? []),
    [ledger?.aggregates?.bySource],
  );

  const selectedWindowLabel = useMemo(() => {
    if (rangeMode !== "custom" || !fromDate || !toDate) return null;
    try {
      resolveSyncRange({ mode: "custom", from: fromDate, to: toDate });
      return `${fromDate} → ${toDate}`;
    } catch {
      return null;
    }
  }, [rangeMode, fromDate, toDate]);

  const assetsSlice = useMemo(
    () => paginateItems(byAssetRows, assetsPage, pageSize),
    [byAssetRows, assetsPage, pageSize],
  );

  const eventsSlice = useMemo(() => {
    const total = eventsTotal;
    const totalPages = totalPagesFor(total, pageSize);
    const safePage = clampPage(eventsPage, totalPages);
    const start = (safePage - 1) * pageSize;
    return {
      items: eventRows,
      page: safePage,
      pageSize,
      total,
      totalPages,
      from: total === 0 ? 0 : start + 1,
      to: start + eventRows.length,
    };
  }, [eventRows, eventsPage, pageSize, eventsTotal]);

  // Keep page in range when filters / sync shrink the list.
  useEffect(() => {
    if (assetsPage !== assetsSlice.page) setAssetsPage(assetsSlice.page);
  }, [assetsPage, assetsSlice.page]);
  useEffect(() => {
    if (eventsPage !== eventsSlice.page) setEventsPage(eventsSlice.page);
  }, [eventsPage, eventsSlice.page]);

  const chartRows = chartEvents.length > 0 ? chartEvents : eventRows;

  const coverageGaps = useMemo(() => {
    if (missingAssets.length > 0) return missingAssets;
    if (byAssetRows.length === 0 || Object.keys(rates).length === 0) return [];
    return auditPriceCoverage(
      byAssetRows.map((a) => a.asset),
      Object.keys(rates),
    ).missing;
  }, [missingAssets, byAssetRows, rates]);

  return (
    <div className="dash">
      <header className="dash-head">
        <div>
          <p className="eyebrow">Ledger</p>
          <h1>What you earned</h1>
        </div>
        <div className="dash-head-actions">
          <label className="currency-select">
            <span className="currency-select-label">Display</span>
            <span className="currency-select-row">
              <CurrencyLogo symbol={activeCurrency} size="sm" showLabel={false} />
              <select
                value={activeCurrency}
                disabled={Boolean(displayCurrencyProp) || busy}
                onChange={(e) =>
                  setCurrency(parseDisplayCurrency(e.target.value))
                }
                aria-label="Display currency"
              >
                {DISPLAY_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c === "USD" ? "USD ($)" : c === "EUR" ? "EUR (€)" : c}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <button
            type="button"
            className="btn-primary sync-btn"
            disabled={busy}
            onClick={() => void runSync("all")}
            aria-busy={busy}
          >
            {busy ? (
              <>
                <span className="sync-spinner" aria-hidden />
                Syncing…
              </>
            ) : (
              "Sync sources"
            )}
          </button>
        </div>
      </header>

      {busy || syncOverview ? (
        <div className="sync-status-strip" role="status" aria-live="polite">
          <span className="sync-spinner" aria-hidden />
          <span>{syncOverview ?? "Sync in progress…"}</span>
        </div>
      ) : null}

      <fieldset className="sync-range">
        <legend className="sync-range-legend">Sync window</legend>
        <div className="sync-range-modes" role="radiogroup" aria-label="Sync window">
          <label className="sync-range-option">
            <input
              type="radio"
              name="sync-range-mode"
              checked={rangeMode === "all"}
              onChange={() => setRangeMode("all")}
              disabled={busy}
            />
            <span>All time</span>
          </label>
          <label className="sync-range-option">
            <input
              type="radio"
              name="sync-range-mode"
              checked={rangeMode === "custom"}
              onChange={() => setRangeMode("custom")}
              disabled={busy}
            />
            <span>Date range</span>
          </label>
        </div>
        <div className="sync-range-dates">
          <label className="sync-range-field">
            <span>From</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                if (rangeMode !== "custom") setRangeMode("custom");
              }}
              disabled={busy || customDisabled}
              max={toDate || undefined}
            />
          </label>
          <label className="sync-range-field">
            <span>To</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                if (rangeMode !== "custom") setRangeMode("custom");
              }}
              disabled={busy || customDisabled}
              min={fromDate || undefined}
            />
          </label>
        </div>
        {rangeMode === "all" ? (
          <label className="sync-range-option sync-range-force">
            <input
              type="checkbox"
              checked={forceFullRefresh}
              onChange={(e) => setForceFullRefresh(e.target.checked)}
              disabled={busy}
            />
            <span>Re-download full history</span>
          </label>
        ) : null}
        <p className="sync-range-hint">
          Sync window applies to Binance and OKX history (UTC day bounds). The
          tables below show your full stored ledger after sync — not a filtered
          preview of the picker. Monad stake and LUNC wallet only refresh
          current pending rewards (not multi-year history). After the first
          sync, All time only picks up new exchange rewards unless you
          re-download full history.
          {selectedWindowLabel
            ? ` Selected CEX window: ${selectedWindowLabel}.`
            : ""}
        </p>
      </fieldset>

      <p className="total">{totalLabel}</p>
      {coverageHint ? <p className="msg">{coverageHint}</p> : null}
      {ratesNote ? <p className="msg">{ratesNote}</p> : null}
      {ledger?.wallet ? (
        <p className="msg mono">Wallet {ledger.wallet.address}</p>
      ) : null}
      {message && !busy ? <p className="msg">{message}</p> : null}
      {coverageGaps.length > 0 ? (
        <p className="msg">
          Missing price rates for: {coverageGaps.slice(0, 8).join(", ")}
          {coverageGaps.length > 8 ? "…" : ""}
        </p>
      ) : null}

      <div className="sources">
        {(Object.keys(SOURCE_LABEL) as SourceId[]).map((id) => {
          const s = ledger?.sources[id];
          const syncing = syncingSources.includes(id);
          const uiStatus: UiSourceStatus = resolveUiSourceStatus(
            s?.status,
            syncing,
          );
          const displayError = syncing
            ? undefined
            : sourceErrorForDisplay(s?.status, s?.error);
          const agg = ledger?.aggregates?.bySource.find((a) => a.source === id);
          const sourceAssets = (ledger?.aggregates?.byAsset ?? []).filter(
            (a) => a.source === id,
          );
          const converted = sumInDisplayCurrency(
            sourceAssets,
            activeCurrency,
            rates,
          );
          const sumLabel =
            converted.total != null
              ? formatDisplayAmount(converted.total, activeCurrency)
              : agg
                ? `Σ ${agg.totalAmount} (native)`
                : "";
          const isPointInTime = id === "monad_stake" || id === "lunc_stake";
          return (
            <div
              key={id}
              className={`source status-${uiStatus}`}
              aria-busy={syncing}
            >
              <span className="source-name">{SOURCE_LABEL[id]}</span>
              <span className="source-status">
                {syncing ? (
                  <>
                    <span className="sync-spinner sync-spinner-sm" aria-hidden />
                    {UI_STATUS_LABEL.syncing}
                  </>
                ) : (
                  UI_STATUS_LABEL[uiStatus]
                )}
              </span>
              <span className="source-count">
                {agg?.eventCount ?? s?.eventCount ?? 0} events
                {sumLabel ? ` · ${sumLabel}` : ""}
              </span>
              {isPointInTime ? (
                <span className="source-hint">Current pending only</span>
              ) : null}
              {displayError ? (
                <span className="source-error">{displayError}</span>
              ) : null}
            </div>
          );
        })}
      </div>

      <EarningsCharts
        events={chartRows}
        convertAmount={convertAmount}
        displayCurrency={chartDisplayCurrency}
      />
      {chartsLoading ? (
        <p className="msg" role="status">
          Loading chart history…
        </p>
      ) : null}

      {byAssetRows.length > 0 ? (
        <div className="table-wrap">
          <table>
            <colgroup>
              <col className="col-asset" />
              <col className="col-source" />
              <col className="col-events" />
              <col className="col-native" />
              <col className="col-fiat" />
            </colgroup>
            <thead>
              <tr>
                <th>Asset</th>
                <th>Source</th>
                <th>Events</th>
                <th>Total (native)</th>
                <th>Total ({activeCurrency})</th>
              </tr>
            </thead>
            <tbody>
              {assetsSlice.items.map((a) => {
                const converted = convertNative(
                  Number(a.totalAmount),
                  a.asset,
                  activeCurrency,
                  rates,
                );
                const fiat = formatDisplayAmount(converted, activeCurrency);
                const sourceLabel = SOURCE_LABEL[a.source];
                return (
                  <tr key={`${a.source}:${a.asset}`}>
                    <td>
                      <CurrencyCell symbol={a.asset} />
                    </td>
                    <td title={sourceLabel}>{sourceLabel}</td>
                    <td className="mono" title={String(a.eventCount)}>
                      {a.eventCount}
                    </td>
                    <td className="mono" title={a.totalAmount}>
                      {a.totalAmount}
                    </td>
                    <td className="mono" title={fiat}>
                      {fiat}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <TablePager
            label="By asset"
            page={assetsSlice.page}
            totalPages={assetsSlice.totalPages}
            from={assetsSlice.from}
            to={assetsSlice.to}
            total={assetsSlice.total}
            pageSize={pageSize}
            onPageChange={setAssetsPage}
            onPageSizeChange={handlePageSizeChange}
          />
        </div>
      ) : null}

      <div className="table-wrap">
        <table>
          <colgroup>
            <col className="col-when" />
            <col className="col-source" />
            <col className="col-asset" />
            <col className="col-amount" />
            <col className="col-fiat" />
          </colgroup>
          <thead>
            <tr>
              <th>When</th>
              <th>Source</th>
              <th>Asset</th>
              <th>Amount</th>
              <th>{activeCurrency}</th>
            </tr>
          </thead>
          <tbody>
            {eventRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty">
                  No earnings yet. Connect Binance, OKX, or a Monad wallet, then
                  sync.
                </td>
              </tr>
            ) : (
              eventsSlice.items.map((e) => {
                const converted = convertNative(
                  Number(e.amount),
                  e.asset,
                  activeCurrency,
                  rates,
                );
                const when = new Date(e.earnedAt).toLocaleString();
                const fiat = formatDisplayAmount(converted, activeCurrency);
                const sourceLabel = SOURCE_LABEL[e.source];
                return (
                  <tr key={e.id}>
                    <td className="mono" title={when}>
                      {when}
                    </td>
                    <td title={sourceLabel}>{sourceLabel}</td>
                    <td>
                      <CurrencyCell symbol={e.asset} />
                    </td>
                    <td className="mono" title={e.amount}>
                      {e.amount}
                    </td>
                    <td className="mono" title={fiat}>
                      {fiat}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
          <TablePager
            label="Events"
            page={eventsSlice.page}
            totalPages={eventsSlice.totalPages}
            from={eventsSlice.from}
            to={eventsSlice.to}
            total={eventsSlice.total}
            pageSize={pageSize}
            onPageChange={handleEventsPageChange}
            onPageSizeChange={handlePageSizeChange}
          />
          {eventsLoading ? (
            <p className="msg" role="status">
              Loading events…
            </p>
          ) : null}
      </div>
    </div>
  );
}

function summarizeFromAggregates(
  ledger: LedgerResponse | null,
  currency: DisplayCurrency,
  rates: RateMap,
  bypassRates: boolean,
): string {
  if (!ledger) return "Loading…";
  const byAsset = ledger.aggregates?.byAsset ?? [];
  if (byAsset.length === 0 && (ledger.events?.length ?? 0) === 0) {
    return "0 events · connect a source to begin";
  }
  const n =
    byAsset.reduce((s, a) => s + a.eventCount, 0) ||
    ledger.eventsTotal ||
    ledger.events.length;
  if (bypassRates || Object.keys(rates).length === 0) {
    if (byAsset.length > 0) {
      const parts = byAsset
        .slice(0, 4)
        .map((a) => `${a.totalAmount} ${a.asset}`);
      return `${n} events · ${parts.join(" · ")}`;
    }
    return `${n} events`;
  }
  const sum = sumInDisplayCurrency(byAsset, currency, rates);
  if (sum.total != null) {
    const skipped =
      sum.skippedAssets.length > 0
        ? ` · ${sum.skippedAssets.length} asset(s) without rate`
        : "";
    return `${n} events · ${formatDisplayAmount(sum.total, currency)}${skipped}`;
  }
  if (byAsset.length > 0) {
    const parts = byAsset
      .slice(0, 4)
      .map((a) => `${a.totalAmount} ${a.asset}`);
    return `${n} events · ${parts.join(" · ")}`;
  }
  return `${n} events`;
}
