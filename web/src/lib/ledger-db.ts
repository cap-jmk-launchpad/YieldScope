import type {
  EarnEvent,
  PersistMode,
  SourceId,
  SourceStatus,
} from "@/lib/adapters/types";
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
    lastEarnedAt: string | null;
  }>;
  byAsset: Array<{
    asset: string;
    source: SourceId;
    eventCount: number;
    totalAmount: string;
  }>;
}

export interface DbLedgerSnapshot {
  events: EarnEvent[];
  sources: Record<
    SourceId,
    { status: SourceStatus; error?: string; eventCount: number; lastSyncedAt?: string }
  >;
  aggregates: LedgerAggregates;
  wallet?: { address: string; chainId: number; lastSeenAt: string } | null;
  updatedAt: string;
}

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
 * Replace one source's earn events for a user and record connection + sync_run.
 * Fail-closed: throws LedgerPersistError on any DB failure.
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
    const chainId = input.chainId ?? 10143;
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

export async function loadDbLedger(userId: string): Promise<DbLedgerSnapshot> {
  if (!isAdminConfigured()) {
    throw new LedgerPersistError("Database not configured.");
  }
  const admin = createAdminClient();
  const { data: profile, error: pErr } = await admin
    .from("profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (pErr) throw new LedgerPersistError(pErr.message);

  const emptySources = (): DbLedgerSnapshot["sources"] => ({
    binance: { status: "not_connected", eventCount: 0 },
    okx: { status: "not_connected", eventCount: 0 },
    monad_stake: { status: "not_connected", eventCount: 0 },
    lunc_stake: { status: "not_connected", eventCount: 0 },
  });

  if (!profile?.id) {
    return {
      events: [],
      sources: emptySources(),
      aggregates: { bySource: [], byAsset: [] },
      wallet: null,
      updatedAt: new Date().toISOString(),
    };
  }

  const profileId = profile.id as string;

  const [sourcesRes, bySourceRes, byAssetRes, walletRes] = await Promise.all([
    admin
      .from("source_connections")
      .select("source,status,last_error,last_synced_at")
      .eq("profile_id", profileId),
    admin
      .from("earn_aggregates_by_source")
      .select("source,event_count,total_amount,last_earned_at")
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
      events.push({
        id: row.id as string,
        source: row.source as SourceId,
        asset: row.asset as string,
        amount: String(row.amount),
        earnedAt: row.earned_at as string,
        rawType: (row.raw_type as string | null) ?? undefined,
        meta: (row.meta as Record<string, unknown>) ?? undefined,
      });
    }
    if (batch.length < PAGE) break;
  }

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
    if (src in sources) {
      sources[src].eventCount = Number(r.event_count);
    }
  }

  const aggregates: LedgerAggregates = {
    bySource: (bySourceRes.data ?? []).map((r) => ({
      source: r.source as SourceId,
      eventCount: Number(r.event_count),
      totalAmount: String(r.total_amount ?? 0),
      lastEarnedAt: (r.last_earned_at as string | null) ?? null,
    })),
    byAsset: (byAssetRes.data ?? []).map((r) => ({
      asset: r.asset as string,
      source: r.source as SourceId,
      eventCount: Number(r.event_count),
      totalAmount: String(r.total_amount ?? 0),
    })),
  };

  const wallet = walletRes.data
    ? {
        address: walletRes.data.address as string,
        chainId: Number(walletRes.data.chain_id),
        lastSeenAt: walletRes.data.last_seen_at as string,
      }
    : null;

  return {
    events,
    sources,
    aggregates,
    wallet,
    updatedAt: new Date().toISOString(),
  };
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
  // Aggregates view is already grouped by asset — cheaper than raw events.
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
