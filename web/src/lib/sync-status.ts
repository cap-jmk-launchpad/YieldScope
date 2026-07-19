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

/** Soft ok-status guidance (e.g. Monad wallet connected but not staked). */
export function sourceInfoForDisplay(
  status: SourceStatus | undefined,
  info: string | undefined,
): string | undefined {
  if (status !== "ok") return undefined;
  const trimmed = info?.trim();
  return trimmed || undefined;
}

export function formatSyncingOverview(pending: SourceId[]): string | null {
  if (pending.length === 0) return null;
  const labels: Record<SourceId, string> = {
    binance: "Binance",
    okx: "OKX",
    monad_stake: "Monad",
    lunc_stake: "Terra Classic",
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

/** True when any source already has persisted earn history (repeat visit). */
export function ledgerHasSyncedHistory(
  sources:
    | Record<
        string,
        { eventCount?: number; lastSyncedAt?: string; status?: SourceStatus }
      >
    | null
    | undefined,
): boolean {
  if (!sources) return false;
  for (const row of Object.values(sources)) {
    if (!row) continue;
    if ((row.eventCount ?? 0) > 0) return true;
    if (row.lastSyncedAt) return true;
    if (row.status === "ok") return true;
  }
  return false;
}

export type AutoImportGate = {
  /** User selected incremental / “import missing” mode (`all` + not force-full). */
  rangeMode: "all" | "custom" | null;
  forceFull: boolean;
  /** Explicit opt-in stored with sync prefs (default true). */
  autoImportMissing: boolean;
  /** Ledger already has history — never auto full-backfill on a cold account. */
  hasSyncedHistory: boolean;
  /** Prefs + first ledger fetch finished. */
  ready: boolean;
  /** Manual sync, mid-flight recovery, or prior auto already started this mount. */
  blocked: boolean;
};

/**
 * Gate for quiet dashboard auto-import of rows newer than each source’s
 * high-water mark. Never triggers for custom ranges or force-full redownloads.
 */
export function shouldAutoImportMissing(gate: AutoImportGate): boolean {
  if (!gate.ready || gate.blocked) return false;
  if (gate.rangeMode !== "all") return false;
  if (gate.forceFull) return false;
  if (!gate.autoImportMissing) return false;
  return gate.hasSyncedHistory;
}
