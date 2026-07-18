import type { EarnEvent, SourceId, SourceStatus } from "@/lib/adapters/types";
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

  const { error: delErr } = await admin
    .from("earn_events")
    .delete()
    .eq("profile_id", profileId)
    .eq("source", input.source);
  if (delErr) {
    throw new LedgerPersistError(`Failed clearing prior events: ${delErr.message}`);
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
    const { error: upErr } = await admin.from("earn_events").upsert(rows, {
      onConflict: "id",
    });
    if (upErr) {
      throw new LedgerPersistError(`Failed writing earn events: ${upErr.message}`);
    }
  }

  const { error: connErr } = await admin.from("source_connections").upsert(
    {
      profile_id: profileId,
      source: input.source,
      status: input.status,
      last_error: input.error ?? null,
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
    meta: {},
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

  const [eventsRes, sourcesRes, bySourceRes, byAssetRes, walletRes] =
    await Promise.all([
      admin
        .from("earn_events")
        .select("id,source,asset,amount,earned_at,raw_type,meta")
        .eq("profile_id", profileId)
        .order("earned_at", { ascending: false })
        .limit(500),
      admin.from("source_connections").select("*").eq("profile_id", profileId),
      admin
        .from("earn_aggregates_by_source")
        .select("*")
        .eq("profile_id", profileId),
      admin
        .from("earn_aggregates_by_asset")
        .select("*")
        .eq("profile_id", profileId),
      admin
        .from("wallet_connections")
        .select("address,chain_id,last_seen_at")
        .eq("profile_id", profileId)
        .order("last_seen_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  for (const res of [eventsRes, sourcesRes, bySourceRes, byAssetRes]) {
    if (res.error) throw new LedgerPersistError(res.error.message);
  }
  if (walletRes.error) throw new LedgerPersistError(walletRes.error.message);

  const sources = emptySources();
  for (const row of sourcesRes.data ?? []) {
    const src = row.source as SourceId;
    if (src in sources) {
      sources[src] = {
        status: row.status as SourceStatus,
        error: row.last_error ?? undefined,
        eventCount: 0,
        lastSyncedAt: row.last_synced_at ?? undefined,
      };
    }
  }

  const events: EarnEvent[] = (eventsRes.data ?? []).map((row) => ({
    id: row.id as string,
    source: row.source as SourceId,
    asset: row.asset as string,
    amount: String(row.amount),
    earnedAt: row.earned_at as string,
    rawType: (row.raw_type as string | null) ?? undefined,
    meta: (row.meta as Record<string, unknown>) ?? undefined,
  }));

  for (const e of events) {
    sources[e.source].eventCount += 1;
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
