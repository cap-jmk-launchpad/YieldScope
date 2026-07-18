import type { SourceId, SourceStatus } from "@/lib/adapters/types";

export const SYNC_SOURCES: SourceId[] = [
  "binance",
  "okx",
  "monad_stake",
  "lunc_stake",
];

/** UI overlay status — includes in-flight syncing. */
export type UiSourceStatus = SourceStatus | "syncing";

export const UI_STATUS_LABEL: Record<UiSourceStatus, string> = {
  ok: "Connected",
  error: "Error",
  not_connected: "Not connected",
  syncing: "Syncing…",
};

const SYNC_SESSION_KEY = "yieldscope.syncInFlight";

export type SyncSession = {
  startedAt: string;
  sources: SourceId[];
  /** Sources still waiting / in progress */
  pending: SourceId[];
};

export function sourcesForSyncTarget(
  target: "all" | SourceId,
): SourceId[] {
  return target === "all" ? [...SYNC_SOURCES] : [target];
}

export function resolveUiSourceStatus(
  persisted: SourceStatus | undefined,
  syncing: boolean,
): UiSourceStatus {
  if (syncing) return "syncing";
  return persisted ?? "not_connected";
}

/** Only real failures — never show leftover last_error on ok / not_connected. */
export function sourceErrorForDisplay(
  status: SourceStatus | undefined,
  error: string | undefined,
): string | undefined {
  if (status !== "error") return undefined;
  return error || "Sync failed";
}

export function formatSyncingOverview(pending: SourceId[]): string | null {
  if (pending.length === 0) return null;
  const labels: Record<SourceId, string> = {
    binance: "Binance",
    okx: "OKX",
    monad_stake: "Monad stake",
    lunc_stake: "LUNC stake",
  };
  if (pending.length === 1) {
    return `Syncing ${labels[pending[0]]}…`;
  }
  return `Syncing ${pending.map((s) => labels[s]).join(", ")}…`;
}

export function writeSyncSession(session: SyncSession): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(SYNC_SESSION_KEY, JSON.stringify(session));
  } catch {
    /* ignore quota */
  }
}

export function clearSyncSession(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(SYNC_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function readSyncSession(): SyncSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SYNC_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SyncSession;
    if (
      !parsed ||
      typeof parsed.startedAt !== "string" ||
      !Array.isArray(parsed.sources) ||
      !Array.isArray(parsed.pending)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Drop stale in-flight markers older than this (tab closed mid-request). */
export const SYNC_SESSION_STALE_MS = 15 * 60 * 1000;

export function isSyncSessionFresh(session: SyncSession, now = Date.now()): boolean {
  const started = Date.parse(session.startedAt);
  if (!Number.isFinite(started)) return false;
  return now - started < SYNC_SESSION_STALE_MS;
}
