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
): LedgerSnapshot {
  const ledger = getLedger();
  const others = ledger.events.filter((e) => e.source !== source);
  ledger.events = [...others, ...result.events].sort(
    (a, b) => new Date(b.earnedAt).getTime() - new Date(a.earnedAt).getTime(),
  );
  ledger.sources[source] = {
    status: result.status,
    error: result.error,
    lastSyncedAt: new Date().toISOString(),
    eventCount: result.events.length,
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
