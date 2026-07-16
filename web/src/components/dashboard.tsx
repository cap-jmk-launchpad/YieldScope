"use client";

import { useCallback, useEffect, useState } from "react";
import type { EarnEvent, SourceId, SourceStatus } from "@/lib/adapters/types";

interface LedgerResponse {
  events: EarnEvent[];
  sources: Record<
    SourceId,
    { status: SourceStatus; error?: string; eventCount: number; lastSyncedAt?: string }
  >;
  updatedAt: string;
}

const SOURCE_LABEL: Record<SourceId, string> = {
  binance: "Binance",
  okx: "OKX",
  monad_stake: "Monad stake",
};

export function Dashboard() {
  const [ledger, setLedger] = useState<LedgerResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/ledger");
    setLedger(await res.json());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function runSync(source: "all" | SourceId = "all") {
    setBusy(true);
    setMessage(null);
    try {
      const body: Record<string, unknown> = { source };
      const stored = sessionStorage.getItem("yieldscope.creds");
      if (stored) {
        const creds = JSON.parse(stored) as {
          binance?: unknown;
          okx?: unknown;
          address?: string;
        };
        if (creds.binance) body.binance = creds.binance;
        if (creds.okx) body.okx = creds.okx;
        if (creds.address) body.address = creds.address;
      }
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      setLedger(json.ledger);
      setMessage("Sync finished — only real adapter results shown.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  }

  const totalLabel = summarizeTotal(ledger?.events ?? []);

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
      {message ? <p className="msg">{message}</p> : null}

      <div className="sources">
        {(Object.keys(SOURCE_LABEL) as SourceId[]).map((id) => {
          const s = ledger?.sources[id];
          return (
            <div key={id} className={`source status-${s?.status ?? "not_connected"}`}>
              <span className="source-name">{SOURCE_LABEL[id]}</span>
              <span className="source-status">{s?.status ?? "not_connected"}</span>
              <span className="source-count">{s?.eventCount ?? 0} events</span>
              {s?.error ? <span className="source-error">{s.error}</span> : null}
            </div>
          );
        })}
      </div>

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

function summarizeTotal(events: EarnEvent[]): string {
  if (events.length === 0) return "0 events · connect a source to begin";
  const byAsset = new Map<string, number>();
  for (const e of events) {
    const n = Number(e.amount);
    if (Number.isFinite(n)) {
      byAsset.set(e.asset, (byAsset.get(e.asset) ?? 0) + n);
    }
  }
  const parts = [...byAsset.entries()]
    .slice(0, 4)
    .map(([asset, amt]) => `${amt.toPrecision(4)} ${asset}`);
  return `${events.length} events · ${parts.join(" · ") || "mixed assets"}`;
}
