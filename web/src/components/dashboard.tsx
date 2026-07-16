"use client";

import { useCallback, useEffect, useState } from "react";
import type { EarnEvent, SourceId, SourceStatus } from "@/lib/adapters/types";

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

export function Dashboard() {
  const [ledger, setLedger] = useState<LedgerResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
  }, [refresh]);

  async function runSync(source: "all" | SourceId = "all") {
    setBusy(true);
    setMessage(null);
    try {
      const body: Record<string, unknown> = { source, chainId: 10143 };
      const stored = sessionStorage.getItem("yieldscope.creds");
      if (stored) {
        const creds = JSON.parse(stored) as {
          binance?: unknown;
          okx?: unknown;
          address?: string;
          luncAddress?: string;
        };
        if (creds.binance) body.binance = creds.binance;
        if (creds.okx) body.okx = creds.okx;
        if (creds.address) body.address = creds.address;
        if (creds.luncAddress) body.luncAddress = creds.luncAddress;
      }
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
        setMessage("Sync finished — events persisted to Supabase.");
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  }

  const totalLabel = summarizeFromAggregates(ledger);

  return (
    <div className="dash">
      <header className="dash-head">
        <div>
          <p className="eyebrow">Ledger</p>
          <h1>What you earned</h1>
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => runSync("all")}
        >
          {busy ? "Syncing…" : "Sync sources"}
        </button>
      </header>

      <p className="total">{totalLabel}</p>
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
          return (
            <div key={id} className={`source status-${s?.status ?? "not_connected"}`}>
              <span className="source-name">{SOURCE_LABEL[id]}</span>
              <span className="source-status">{s?.status ?? "not_connected"}</span>
              <span className="source-count">
                {agg?.eventCount ?? s?.eventCount ?? 0} events
                {agg ? ` · Σ ${agg.totalAmount}` : ""}
              </span>
              {s?.error ? <span className="source-error">{s.error}</span> : null}
            </div>
          );
        })}
      </div>

      {ledger?.aggregates?.byAsset && ledger.aggregates.byAsset.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Asset</th>
                <th>Source</th>
                <th>Events</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {ledger.aggregates.byAsset.map((a) => (
                <tr key={`${a.source}:${a.asset}`}>
                  <td>{a.asset}</td>
                  <td>{SOURCE_LABEL[a.source]}</td>
                  <td className="mono">{a.eventCount}</td>
                  <td className="mono">{a.totalAmount}</td>
                </tr>
              ))}
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
            </tr>
          </thead>
          <tbody>
            {(ledger?.events ?? []).length === 0 ? (
              <tr>
                <td colSpan={4} className="empty">
                  No earn rows yet. Connect Binance / OKX or a Monad wallet, then sync.
                  Broken sources show error — we never invent placeholder earnings.
                </td>
              </tr>
            ) : (
              ledger!.events.map((e) => (
                <tr key={e.id}>
                  <td className="mono">{new Date(e.earnedAt).toLocaleString()}</td>
                  <td>{SOURCE_LABEL[e.source]}</td>
                  <td>{e.asset}</td>
                  <td className="mono">{e.amount}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function summarizeFromAggregates(ledger: LedgerResponse | null): string {
  if (!ledger) return "Loading…";
  const byAsset = ledger.aggregates?.byAsset ?? [];
  if (byAsset.length === 0 && (ledger.events?.length ?? 0) === 0) {
    return "0 events · connect a source to begin";
  }
  if (byAsset.length > 0) {
    const parts = byAsset
      .slice(0, 4)
      .map((a) => `${Number(a.totalAmount).toPrecision(4)} ${a.asset}`);
    const n = byAsset.reduce((s, a) => s + a.eventCount, 0);
    return `${n} events · ${parts.join(" · ")}`;
  }
  return `${ledger.events.length} events`;
}
