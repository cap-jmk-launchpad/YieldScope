import type {
  EarnEvent,
  PersistMode,
  SourceId,
  SourceStatus,
} from "@/lib/adapters/types";
import { DEFAULT_MONAD_CHAIN_ID } from "@/lib/contracts";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export class LedgerPersistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerPersistError";
  }
}

export interface PersistSourceInput {
  userId: string;
  source: SourceId;
  status: SourceStatus;
  events: EarnEvent[];
  error?: string;
  walletAddress?: string | null;
  chainId?: number;
  /**
   * When set, only replace events inside [mergeFromMs, mergeToMs] (inclusive)
   * and keep existing rows outside the window. Omit for full source replace.
   */
  mergeFromMs?: number | null;
  mergeToMs?: number | null;
  /** Explicit persist strategy; defaults from merge bounds when omitted. */
  persistMode?: PersistMode;
  /** Recorded on sync_runs.meta for audit (range / plan). */
  syncMeta?: Record<string, unknown>;
}

export interface LedgerAggregates {
  bySource: Array<{
    source: SourceId;
    eventCount: number;
    totalAmount: string;
    firstEarnedAt: string | null;
    lastEarnedAt: string | null;
  }>;
  byAsset: Array<{
    asset: string;
    source: SourceId;
    eventCount: number;
    totalAmount: string;
  }>;
}

/** How earn_events are included in a ledger snapshot. */
export type LedgerEventsMode = "all" | "page" | "none" | "chart";

/** Server-side sort columns for paged earn_events (matches DB columns). */
export type LedgerEventsSort = "earned_at" | "amount" | "asset" | "source";
export type LedgerSortOrder = "asc" | "desc";

export const LEDGER_EVENTS_SORT_COLUMNS: readonly LedgerEventsSort[] = [
  "earned_at",
  "amount",
  "asset",
  "source",
] as const;

export function parseLedgerEventsSort(
  raw: string | null | undefined,
): LedgerEventsSort {
  if (
    raw === "earned_at" ||
    raw === "amount" ||
    raw === "asset" ||
    raw === "source"
  ) {
    return raw;
  }
  return "earned_at";
}

export function parseLedgerSortOrder(
  raw: string | null | undefined,
): LedgerSortOrder {
  return raw === "asc" ? "asc" : "desc";
}

export interface LoadDbLedgerOptions {
  /**
   * - `all` — page through every event (checkpoint / legacy). Default for
   *   callers that omit options so merkle/checkpoint stay correct.
   * - `page` — one page for the events table (dashboard TTI).
   * - `none` — aggregates/sources only (prices, sync response).
   * - `chart` — UTC-day × asset series from earn_daily_by_asset (deferred charts).
   */
  eventsMode?: LedgerEventsMode;
  /** 1-based page when eventsMode is `page`. */
  eventsPage?: number;
  eventsPageSize?: number;
  /** Column to ORDER BY when eventsMode is `page` (default earned_at). */
  eventsSort?: LedgerEventsSort;
  /** asc | desc (default desc). */
  eventsOrder?: LedgerSortOrder;
}

export interface DbLedgerSnapshot {
  events: EarnEvent[];
  /** Total earn_events for the profile (from aggregates). */
  eventsTotal: number;
  eventsMode: LedgerEventsMode;
  eventsPage?: number;
  eventsPageSize?: number;
  eventsSort?: LedgerEventsSort;
  eventsOrder?: LedgerSortOrder;
  sources: Record<
    SourceId,
    { status: SourceStatus; error?: string; eventCount: number; lastSyncedAt?: string }
  >;
  aggregates: LedgerAggregates;
  wallet?: { address: string; chainId: number; lastSeenAt: string } | null;
  updatedAt: string;
}

export const DEFAULT_LEDGER_EVENTS_PAGE_SIZE = 25;
export const MAX_LEDGER_EVENTS_PAGE_SIZE = 500;

export async function ensureProfileId(userId: string, email?: string | null): Promise<string> {
  const admin = createAdminClient();
  const { data: existing, error: selectErr } = await admin
    .from("profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (selectErr) {
    throw new LedgerPersistError(`Profile lookup failed: ${selectErr.message}`);
  }
  if (existing?.id) return existing.id as string;

  const { data: inserted, error: insertErr } = await admin
    .from("profiles")
    .insert({ user_id: userId, email: email ?? null })
    .select("id")
    .single();
  if (insertErr || !inserted?.id) {
    throw new LedgerPersistError(
      `Profile create failed: ${insertErr?.message ?? "unknown"}`,
    );
  }
  return inserted.id as string;
}

/**
 * Rebuild precomputed aggregates for one profile from earn_events.
 * Invoked at the end of every persistSourceSync (replace / merge / upsert)
 * so dashboard totals and charts never scan raw events.
 */
export async function refreshEarnAggregatesForProfile(
  profileId: string,
): Promise<void> {
  if (!isAdminConfigured()) {
    throw new LedgerPersistError(
      "Database not configured — cannot refresh aggregates.",
    );
  }
  const admin = createAdminClient();
  const { error } = await admin.rpc("refresh_earn_aggregates_for_profile", {
    p_profile_id: profileId,
  });
  if (error) {
    throw new LedgerPersistError(
      `Failed refreshing earn aggregates: ${error.message}`,
    );
  }
}

/**
 * Replace one source's earn events for a user and record connection + sync_run.
 * Fail-closed: throws LedgerPersistError on any DB failure.
 *
 * Aggregate refresh: AFTER events + connection + sync_run succeed, calls
 * refresh_earn_aggregates_for_profile so by_source / by_asset / daily tables
 * match the ledger. Full-profile recompute (not window-sliced) so custom-range
 * merge and LUNC history crawls stay correct.
 */
export async function persistSourceSync(
  input: PersistSourceInput & { email?: string | null },
): Promise<{ profileId: string; eventCount: number }> {
  if (!isAdminConfigured()) {
    throw new LedgerPersistError(
      "Database not configured — cannot persist sync (fail closed).",
    );
  }

  const asOf = new Date().toISOString();
  const profileId = await ensureProfileId(input.userId, input.email);
  const admin = createAdminClient();

  const mergeBounds =
    input.mergeFromMs != null &&
    input.mergeToMs != null &&
    Number.isFinite(input.mergeFromMs) &&
    Number.isFinite(input.mergeToMs);

  const persistMode =
    input.persistMode ??
    (mergeBounds ? "merge" : "replace");

  if (persistMode !== "upsert") {
    let delQuery = admin
      .from("earn_events")
      .delete()
      .eq("profile_id", profileId)
      .eq("source", input.source);
    if (persistMode === "merge" && mergeBounds) {
      delQuery = delQuery
        .gte("earned_at", new Date(input.mergeFromMs!).toISOString())
        .lte("earned_at", new Date(input.mergeToMs!).toISOString());
    }
    const { error: delErr } = await delQuery;
    if (delErr) {
      throw new LedgerPersistError(`Failed clearing prior events: ${delErr.message}`);
    }
  }

  if (input.events.length > 0) {
    const rows = input.events.map((e) => ({
      id: e.id,
      profile_id: profileId,
      source: e.source,
      asset: e.asset,
      amount: e.amount,
      earned_at: e.earnedAt,
      raw_type: e.rawType ?? null,
      meta: e.meta ?? {},
      as_of: asOf,
    }));
    // Chunk to keep PostgREST payloads under proxy/body limits (CEX backfills).
    const chunkSize = 500;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error: upErr } = await admin.from("earn_events").upsert(chunk, {
        onConflict: "id",
      });
      if (upErr) {
        throw new LedgerPersistError(
          `Failed writing earn events: ${upErr.message}`,
        );
      }
    }
  }

  const { error: connErr } = await admin.from("source_connections").upsert(
    {
      profile_id: profileId,
      source: input.source,
      status: input.status,
      // Clear stale errors whenever this source is not currently failing.
      last_error: input.status === "error" ? (input.error ?? null) : null,
      last_synced_at: asOf,
    },
    { onConflict: "profile_id,source" },
  );
  if (connErr) {
    throw new LedgerPersistError(`Failed updating source connection: ${connErr.message}`);
  }

  const { error: runErr } = await admin.from("sync_runs").insert({
    profile_id: profileId,
    source: input.source,
    status: input.status,
    event_count: input.events.length,
    error: input.error ?? null,
    started_at: asOf,
    finished_at: asOf,
    meta: {
      persistMode,
      ...(input.mergeFromMs != null ? { mergeFromMs: input.mergeFromMs } : {}),
      ...(input.mergeToMs != null ? { mergeToMs: input.mergeToMs } : {}),
      ...(input.syncMeta ?? {}),
    },
  });
  if (runErr) {
    throw new LedgerPersistError(`Failed recording sync_run: ${runErr.message}`);
  }

  if (input.walletAddress) {
    const chainId = input.chainId ?? DEFAULT_MONAD_CHAIN_ID;
    const { error: walletErr } = await admin.from("wallet_connections").upsert(
      {
        profile_id: profileId,
        address: input.walletAddress.toLowerCase(),
        chain_id: chainId,
        last_seen_at: asOf,
      },
      { onConflict: "profile_id,address,chain_id" },
    );
    if (walletErr) {
      throw new LedgerPersistError(
        `Failed recording wallet connection: ${walletErr.message}`,
      );
    }
    const { error: profileWalletErr } = await admin
      .from("profiles")
      .update({ wallet_address: input.walletAddress.toLowerCase() })
      .eq("id", profileId);
    if (profileWalletErr) {
      throw new LedgerPersistError(
        `Failed updating profile wallet: ${profileWalletErr.message}`,
      );
    }
  }

  // AFTER persist — not lazy on read. Merge/upsert still full-profile refresh.
  await refreshEarnAggregatesForProfile(profileId);

  return { profileId, eventCount: input.events.length };
}

/**
 * Max earned_at (ms) for a user's source — high-water mark for incremental sync.
 * Returns null when no events exist (first backfill needed).
 */
export async function getSourceHighWaterMs(
  userId: string,
  source: SourceId,
): Promise<number | null> {
  if (!isAdminConfigured()) return null;

  const admin = createAdminClient();
  const { data: profile, error: pErr } = await admin
    .from("profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (pErr) {
    throw new LedgerPersistError(`Profile lookup failed: ${pErr.message}`);
  }
  if (!profile?.id) return null;

  const { data, error } = await admin
    .from("earn_events")
    .select("earned_at")
    .eq("profile_id", profile.id)
    .eq("source", source)
    .order("earned_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new LedgerPersistError(
      `Failed reading high-water mark: ${error.message}`,
    );
  }
  if (!data?.earned_at) return null;
  const ms = Date.parse(String(data.earned_at));
  return Number.isFinite(ms) ? ms : null;
}

function emptySources(): DbLedgerSnapshot["sources"] {
  return {
    binance: { status: "not_connected", eventCount: 0 },
    okx: { status: "not_connected", eventCount: 0 },
    monad_stake: { status: "not_connected", eventCount: 0 },
    lunc_stake: { status: "not_connected", eventCount: 0 },
  };
}

function emptySnapshot(mode: LedgerEventsMode): DbLedgerSnapshot {
  return {
    events: [],
    eventsTotal: 0,
    eventsMode: mode,
    sources: emptySources(),
    aggregates: { bySource: [], byAsset: [] },
    wallet: null,
    updatedAt: new Date().toISOString(),
  };
}

function mapEventRow(row: Record<string, unknown>, slim: boolean): EarnEvent {
  const event: EarnEvent = {
    id: String(row.id ?? ""),
    source: row.source as SourceId,
    asset: String(row.asset),
    amount: String(row.amount),
    earnedAt: String(row.earned_at),
  };
  if (!slim) {
    event.rawType = (row.raw_type as string | null) ?? undefined;
    event.meta = (row.meta as Record<string, unknown>) ?? undefined;
  }
  return event;
}

function clampEventsPageSize(size: number | undefined): number {
  if (size == null || !Number.isFinite(size) || size < 1) {
    return DEFAULT_LEDGER_EVENTS_PAGE_SIZE;
  }
  return Math.min(Math.floor(size), MAX_LEDGER_EVENTS_PAGE_SIZE);
}

function clampEventsPage(page: number | undefined): number {
  if (page == null || !Number.isFinite(page) || page < 1) return 1;
  return Math.floor(page);
}

async function loadAllEarnEvents(
  admin: ReturnType<typeof createAdminClient>,
  profileId: string,
): Promise<EarnEvent[]> {
  // Page through all earn events. A hard 500-row cap previously made multi-year
  // history look like "only a couple of days" in the UI/charts.
  const PAGE = 1000;
  const MAX_EVENTS = 100_000;
  const events: EarnEvent[] = [];
  for (let from = 0; from < MAX_EVENTS; from += PAGE) {
    const to = Math.min(from + PAGE - 1, MAX_EVENTS - 1);
    const { data, error } = await admin
      .from("earn_events")
      .select("id,source,asset,amount,earned_at,raw_type,meta")
      .eq("profile_id", profileId)
      .order("earned_at", { ascending: false })
      .range(from, to);
    if (error) throw new LedgerPersistError(error.message);
    const batch = data ?? [];
    for (const row of batch) {
      events.push(mapEventRow(row as Record<string, unknown>, false));
    }
    if (batch.length < PAGE) break;
  }
  return events;
}

async function loadEarnEventsPage(
  admin: ReturnType<typeof createAdminClient>,
  profileId: string,
  page: number,
  pageSize: number,
  sort: LedgerEventsSort = "earned_at",
  order: LedgerSortOrder = "desc",
): Promise<EarnEvent[]> {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const ascending = order === "asc";
  // Table list omits meta (can be large on CEX reward rows).
  // Primary sort + earned_at / id tiebreakers keep page boundaries stable.
  let query = admin
    .from("earn_events")
    .select("id,source,asset,amount,earned_at,raw_type")
    .eq("profile_id", profileId)
    .order(sort, { ascending });
  if (sort !== "earned_at") {
    query = query.order("earned_at", { ascending: false });
  }
  query = query.order("id", { ascending: true }).range(from, to);
  const { data, error } = await query;
  if (error) throw new LedgerPersistError(error.message);
  return (data ?? []).map((row) =>
    mapEventRow(row as Record<string, unknown>, true),
  );
}

/**
 * Chart series: one synthetic event per (source, asset, UTC day) from the
 * precomputed daily aggregate table — orders of magnitude smaller than raw
 * earn_events. Table is refreshed after every persistSourceSync.
 */
async function loadChartSeriesEvents(
  admin: ReturnType<typeof createAdminClient>,
  profileId: string,
): Promise<EarnEvent[]> {
  const PAGE = 1000;
  const MAX_ROWS = 50_000;
  const events: EarnEvent[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const to = Math.min(from + PAGE - 1, MAX_ROWS - 1);
    const { data, error } = await admin
      .from("earn_daily_by_asset")
      .select("source,asset,day,total_amount")
      .eq("profile_id", profileId)
      .order("day", { ascending: true })
      .range(from, to);
    if (error) throw new LedgerPersistError(error.message);
    const batch = data ?? [];
    for (const row of batch) {
      const day = String(row.day).slice(0, 10);
      const source = row.source as SourceId;
      const asset = String(row.asset);
      events.push({
        id: `daily:${source}:${asset}:${day}`,
        source,
        asset,
        amount: String(row.total_amount ?? 0),
        earnedAt: `${day}T00:00:00.000Z`,
      });
    }
    if (batch.length < PAGE) break;
  }
  return events;
}

export async function loadDbLedger(
  userId: string,
  options: LoadDbLedgerOptions = {},
): Promise<DbLedgerSnapshot> {
  if (!isAdminConfigured()) {
    throw new LedgerPersistError("Database not configured.");
  }
  const eventsMode: LedgerEventsMode = options.eventsMode ?? "all";
  const eventsPage = clampEventsPage(options.eventsPage);
  const eventsPageSize = clampEventsPageSize(options.eventsPageSize);
  const eventsSort = parseLedgerEventsSort(options.eventsSort);
  const eventsOrder = parseLedgerSortOrder(options.eventsOrder);

  const admin = createAdminClient();
  const { data: profile, error: pErr } = await admin
    .from("profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (pErr) throw new LedgerPersistError(pErr.message);

  if (!profile?.id) {
    const empty = emptySnapshot(eventsMode);
    if (eventsMode === "page") {
      empty.eventsPage = eventsPage;
      empty.eventsPageSize = eventsPageSize;
      empty.eventsSort = eventsSort;
      empty.eventsOrder = eventsOrder;
    }
    return empty;
  }

  const profileId = profile.id as string;

  const [sourcesRes, bySourceRes, byAssetRes, walletRes] = await Promise.all([
    admin
      .from("source_connections")
      .select("source,status,last_error,last_synced_at")
      .eq("profile_id", profileId),
    admin
      .from("earn_aggregates_by_source")
      .select("source,event_count,total_amount,first_earned_at,last_earned_at")
      .eq("profile_id", profileId),
    admin
      .from("earn_aggregates_by_asset")
      .select("asset,source,event_count,total_amount")
      .eq("profile_id", profileId),
    admin
      .from("wallet_connections")
      .select("address,chain_id,last_seen_at")
      .eq("profile_id", profileId)
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  for (const res of [sourcesRes, bySourceRes, byAssetRes]) {
    if (res.error) throw new LedgerPersistError(res.error.message);
  }
  if (walletRes.error) throw new LedgerPersistError(walletRes.error.message);

  const sources = emptySources();
  for (const row of sourcesRes.data ?? []) {
    const src = row.source as SourceId;
    if (src in sources) {
      const status = row.status as SourceStatus;
      sources[src] = {
        status,
        // Only surface errors for failing sources — never stale last_error on ok.
        error:
          status === "error" ? (row.last_error ?? undefined) : undefined,
        eventCount: 0,
        lastSyncedAt: row.last_synced_at ?? undefined,
      };
    }
  }

  // Prefer aggregate counts (full ledger) over counting the loaded event page.
  for (const r of bySourceRes.data ?? []) {
    const src = r.source as SourceId;
    if (!(src in sources)) continue;
    sources[src].eventCount = Number(r.event_count);
  }

  const aggregates: LedgerAggregates = {
    bySource: (bySourceRes.data ?? []).map((r) => ({
      source: r.source as SourceId,
      eventCount: Number(r.event_count),
      totalAmount: String(r.total_amount ?? 0),
      firstEarnedAt: (r.first_earned_at as string | null) ?? null,
      lastEarnedAt: (r.last_earned_at as string | null) ?? null,
    })),
    // Default: largest native totals first so by-asset table first page is useful.
    byAsset: (byAssetRes.data ?? [])
      .map((r) => ({
        asset: r.asset as string,
        source: r.source as SourceId,
        eventCount: Number(r.event_count),
        totalAmount: String(r.total_amount ?? 0),
      }))
      .sort((a, b) => {
        const diff = Number(b.totalAmount) - Number(a.totalAmount);
        if (Number.isFinite(diff) && diff !== 0) return diff;
        return a.asset.localeCompare(b.asset) || a.source.localeCompare(b.source);
      }),
  };

  const eventsTotal = aggregates.bySource.reduce(
    (sum, row) => sum + row.eventCount,
    0,
  );

  let events: EarnEvent[] = [];
  if (eventsMode === "all") {
    events = await loadAllEarnEvents(admin, profileId);
  } else if (eventsMode === "page") {
    events = await loadEarnEventsPage(
      admin,
      profileId,
      eventsPage,
      eventsPageSize,
      eventsSort,
      eventsOrder,
    );
  } else if (eventsMode === "chart") {
    events = await loadChartSeriesEvents(admin, profileId);
  }

  const wallet = walletRes.data
    ? {
        address: walletRes.data.address as string,
        chainId: Number(walletRes.data.chain_id),
        lastSeenAt: walletRes.data.last_seen_at as string,
      }
    : null;

  const snap: DbLedgerSnapshot = {
    events,
    eventsTotal,
    eventsMode,
    sources,
    aggregates,
    wallet,
    updatedAt: new Date().toISOString(),
  };
  if (eventsMode === "page") {
    snap.eventsPage = eventsPage;
    snap.eventsPageSize = eventsPageSize;
    snap.eventsSort = eventsSort;
    snap.eventsOrder = eventsOrder;
  }
  return snap;
}

/**
 * Distinct earn assets for one user — cheap aggregates path for /api/prices
 * (avoids loading the full event history just to discover symbols).
 */
export async function loadUserEarnAssets(userId: string): Promise<string[]> {
  if (!isAdminConfigured()) return [];

  const admin = createAdminClient();
  const { data: profile, error: pErr } = await admin
    .from("profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (pErr) throw new LedgerPersistError(pErr.message);
  if (!profile?.id) return [];

  const { data, error } = await admin
    .from("earn_aggregates_by_asset")
    .select("asset")
    .eq("profile_id", profile.id);
  if (error) {
    throw new LedgerPersistError(
      `Failed listing user earn assets: ${error.message}`,
    );
  }
  const set = new Set<string>();
  for (const row of data ?? []) {
    const a = String(row.asset ?? "")
      .trim()
      .toUpperCase();
    if (a) set.add(a);
  }
  return [...set].sort();
}

/**
 * Distinct asset tickers across all earn_events (service role).
 * Used by price sync to warm USDT pairs for imported cryptos.
 */
export async function listDistinctEarnAssets(): Promise<string[]> {
  if (!isAdminConfigured()) {
    throw new LedgerPersistError("Database not configured.");
  }
  const admin = createAdminClient();
  // Precomputed by-asset table — cheaper than scanning raw earn_events.
  const { data, error } = await admin
    .from("earn_aggregates_by_asset")
    .select("asset");
  if (error) {
    throw new LedgerPersistError(
      `Failed listing earn assets: ${error.message}`,
    );
  }
  const set = new Set<string>();
  for (const row of data ?? []) {
    const a = String(row.asset ?? "")
      .trim()
      .toUpperCase();
    if (a) set.add(a);
  }
  return [...set].sort();
}
