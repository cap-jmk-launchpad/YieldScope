import type { EarnEvent, SourceId, SourceStatus } from "./adapters/types";

export interface SourceState {
  status: SourceStatus;
  error?: string;
  lastSyncedAt?: string;
  eventCount: number;
}

export interface LedgerSnapshot {
  events: EarnEvent[];
  sources: Record<SourceId, SourceState>;
  updatedAt: string;
}

const g = globalThis as unknown as {
  __yieldscopeLedger?: LedgerSnapshot;
};

function emptySources(): Record<SourceId, SourceState> {
  return {
    binance: { status: "not_connected", eventCount: 0 },
    okx: { status: "not_connected", eventCount: 0 },
    monad_stake: { status: "not_connected", eventCount: 0 },
    lunc_stake: { status: "not_connected", eventCount: 0 },
  };
}

export function getLedger(): LedgerSnapshot {
  if (!g.__yieldscopeLedger) {
    g.__yieldscopeLedger = {
      events: [],
      sources: emptySources(),
      updatedAt: new Date().toISOString(),
    };
  }
  return g.__yieldscopeLedger;
}

export function replaceSourceEvents(
  source: SourceId,
  result: { status: SourceStatus; events: EarnEvent[]; error?: string },
  opts?: {
    mergeFromMs?: number | null;
    mergeToMs?: number | null;
    /** When true, keep all existing source events and dedupe by id. */
    upsertOnly?: boolean;
  },
): LedgerSnapshot {
  const ledger = getLedger();
  const fromMs = opts?.mergeFromMs;
  const toMs = opts?.mergeToMs;
  const merge =
    fromMs != null && toMs != null && Number.isFinite(fromMs) && Number.isFinite(toMs);

  let others: EarnEvent[];
  if (opts?.upsertOnly) {
    const incomingIds = new Set(result.events.map((e) => e.id));
    others = ledger.events.filter(
      (e) => e.source !== source || !incomingIds.has(e.id),
    );
  } else {
    others = ledger.events.filter((e) => {
      if (e.source !== source) return true;
      if (!merge) return false;
      const t = Date.parse(e.earnedAt);
      // Keep events outside the synced window
      return t < fromMs! || t > toMs!;
    });
  }

  const merged = [...others, ...result.events].sort(
    (a, b) => new Date(b.earnedAt).getTime() - new Date(a.earnedAt).getTime(),
  );
  ledger.events = merged;
  const sourceCount = merged.filter((e) => e.source === source).length;
  ledger.sources[source] = {
    status: result.status,
    // Never keep a previous error string after an ok / not_connected sync.
    error: result.status === "error" ? result.error : undefined,
    lastSyncedAt: new Date().toISOString(),
    eventCount: sourceCount,
  };
  ledger.updatedAt = new Date().toISOString();
  return ledger;
}

export function resetLedger(): void {
  g.__yieldscopeLedger = {
    events: [],
    sources: emptySources(),
    updatedAt: new Date().toISOString(),
  };
}
