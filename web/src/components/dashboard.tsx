"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import type { EarnEvent, SourceId, SourceStatus } from "@/lib/adapters/types";
import { EarningsCharts } from "@/components/earnings-charts";
import type { ConvertAmount } from "@/lib/earnings-charts";
import type { SyncRange, SyncRangeMode } from "@/lib/sync-range";
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
  sources: Record<
    SourceId,
    { status: SourceStatus; error?: string; eventCount: number; lastSyncedAt?: string }
  >;
  aggregates?: {
    bySource: Array<{
      source: SourceId;
      eventCount: number;
      totalAmount: string;
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

function defaultMonthBounds(): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const fromDate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const from = fromDate.toISOString().slice(0, 10);
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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [rangeMode, setRangeMode] = useState<SyncRangeMode>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [currency, setCurrency] = useState<DisplayCurrency>("USD");
  const [rates, setRates] = useState<RateMap>({});
  const [ratesNote, setRatesNote] = useState<string | null>(null);
  const { address, chainId } = useAccount();

  useEffect(() => {
    const saved = loadSavedRange();
    setRangeMode(saved.mode);
    setFromDate(saved.from);
    setToDate(saved.to);
    setCurrency(loadDisplayCurrencyFromStorage(window.localStorage));
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

  const refreshRates = useCallback(async () => {
    try {
      const res = await fetch("/api/prices");
      const json = (await res.json()) as {
        rates?: RateMap;
        error?: string;
        note?: string;
      };
      if (!res.ok) {
        setRatesNote(json.error ?? "Price rates unavailable");
        return;
      }
      setRates(json.rates ?? {});
      setRatesNote(
        Object.keys(json.rates ?? {}).length === 0
          ? "No price ticks yet — minute sync may still be warming up"
          : null,
      );
    } catch (err) {
      setRatesNote(err instanceof Error ? err.message : "Price fetch failed");
    }
  }, []);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/ledger");
    const json = (await res.json()) as LedgerResponse;
    setLedger(json);
    if (!res.ok) {
      setMessage(json.error ?? "Failed to load ledger");
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshRates();
  }, [refresh, refreshRates]);

  async function runSync(source: "all" | SourceId = "all") {
    setBusy(true);
    setMessage(null);
    try {
      const range: SyncRange =
        rangeMode === "all"
          ? { mode: "all" }
          : { mode: "custom", from: fromDate, to: toDate };

      if (range.mode === "custom" && (!range.from || !range.to)) {
        setMessage("Pick both from and to dates, or choose All time.");
        setBusy(false);
        return;
      }

      const body: Record<string, unknown> = {
        source,
        chainId: chainId ?? 10143,
        range,
      };
      if (address) body.address = address;
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ledger) setLedger(json.ledger);
      if (!res.ok) {
        setMessage(json.error ?? "Sync failed — persist may have failed closed.");
      } else {
        const modeLabel =
          range.mode === "all"
            ? "all time"
            : `${range.from} → ${range.to}`;
        setMessage(
          `Sync finished (${modeLabel}) — Binance/OKX history in range; Monad/LUNC current pending.`,
        );
        void refreshRates();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setBusy(false);
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
          </label>
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() => runSync("all")}
          >
            {busy ? "Syncing…" : "Sync sources"}
          </button>
        </div>
      </header>

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
        <p className="sync-range-hint">
          Range filters Binance / OKX earn history. Monad and LUNC always refresh
          current pending rewards. Totals convert via Binance prices stored in
          Postgres (1m ticks).
        </p>
      </fieldset>

      <p className="total">{totalLabel}</p>
      {ratesNote ? <p className="msg">{ratesNote}</p> : null}
      {ledger?.wallet ? (
        <p className="msg mono">
          Wallet {ledger.wallet.address} · chain {ledger.wallet.chainId}
        </p>
      ) : null}
      {message ? <p className="msg">{message}</p> : null}

      <div className="sources">
        {(Object.keys(SOURCE_LABEL) as SourceId[]).map((id) => {
          const s = ledger?.sources[id];
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
          return (
            <div key={id} className={`source status-${s?.status ?? "not_connected"}`}>
              <span className="source-name">{SOURCE_LABEL[id]}</span>
              <span className="source-status">{s?.status ?? "not_connected"}</span>
              <span className="source-count">
                {agg?.eventCount ?? s?.eventCount ?? 0} events
                {sumLabel ? ` · ${sumLabel}` : ""}
              </span>
              {s?.error ? <span className="source-error">{s.error}</span> : null}
            </div>
          );
        })}
      </div>

      <EarningsCharts
        events={ledger?.events ?? []}
        convertAmount={convertAmount}
        displayCurrency={chartDisplayCurrency}
      />

      {ledger?.aggregates?.byAsset && ledger.aggregates.byAsset.length > 0 ? (
        <div className="table-wrap">
          <table>
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
              {ledger.aggregates.byAsset.map((a) => {
                const converted = convertNative(
                  Number(a.totalAmount),
                  a.asset,
                  activeCurrency,
                  rates,
                );
                return (
                  <tr key={`${a.source}:${a.asset}`}>
                    <td>{a.asset}</td>
                    <td>{SOURCE_LABEL[a.source]}</td>
                    <td className="mono">{a.eventCount}</td>
                    <td className="mono">{a.totalAmount}</td>
                    <td className="mono">
                      {formatDisplayAmount(converted, activeCurrency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="table-wrap">
        <table>
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
            {(ledger?.events ?? []).length === 0 ? (
              <tr>
                <td colSpan={5} className="empty">
                  No earn rows yet. Connect Binance / OKX or a Monad wallet, then sync.
                  Broken sources show error — we never invent placeholder earnings.
                </td>
              </tr>
            ) : (
              ledger!.events.map((e) => {
                const converted = convertNative(
                  Number(e.amount),
                  e.asset,
                  activeCurrency,
                  rates,
                );
                return (
                  <tr key={e.id}>
                    <td className="mono">{new Date(e.earnedAt).toLocaleString()}</td>
                    <td>{SOURCE_LABEL[e.source]}</td>
                    <td>{e.asset}</td>
                    <td className="mono">{e.amount}</td>
                    <td className="mono">
                      {formatDisplayAmount(converted, activeCurrency)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
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
  const n = byAsset.reduce((s, a) => s + a.eventCount, 0) || ledger.events.length;
  if (bypassRates || Object.keys(rates).length === 0) {
    if (byAsset.length > 0) {
      const parts = byAsset
        .slice(0, 4)
        .map((a) => `${Number(a.totalAmount).toPrecision(4)} ${a.asset}`);
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
      .map((a) => `${Number(a.totalAmount).toPrecision(4)} ${a.asset}`);
    return `${n} events · ${parts.join(" · ")}`;
  }
  return `${n} events`;
}
