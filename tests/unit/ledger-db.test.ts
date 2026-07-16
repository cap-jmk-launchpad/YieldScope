import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();
const isAdminConfigured = vi.fn(() => true);

vi.mock("../../web/src/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from }),
  isAdminConfigured: () => isAdminConfigured(),
}));

describe("ledger-db persistence", () => {
  const original = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...original };
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
    isAdminConfigured.mockReturnValue(true);
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("persistSourceSync fails closed when admin not configured", async () => {
    isAdminConfigured.mockReturnValue(false);
    const { persistSourceSync, LedgerPersistError } = await import(
      "../../web/src/lib/ledger-db"
    );
    await expect(
      persistSourceSync({
        userId: "u1",
        source: "binance",
        status: "ok",
        events: [],
      }),
    ).rejects.toBeInstanceOf(LedgerPersistError);
  });

  it("persistSourceSync upserts events and connections", async () => {
    const profile = { id: "p1" };
    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: profile, error: null }),
            }),
          }),
          update: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      }
      if (table === "earn_events") {
        return {
          delete: () => ({
            eq: () => ({
              eq: async () => ({ error: null }),
            }),
          }),
          upsert: async () => ({ error: null }),
        };
      }
      if (table === "source_connections" || table === "wallet_connections") {
        return { upsert: async () => ({ error: null }) };
      }
      if (table === "sync_runs") {
        return { insert: async () => ({ error: null }) };
      }
      return {};
    });

    const { persistSourceSync } = await import("../../web/src/lib/ledger-db");
    const result = await persistSourceSync({
      userId: "u1",
      email: "a@b.c",
      source: "binance",
      status: "ok",
      events: [
        {
          id: "binance:1",
          source: "binance",
          asset: "USDT",
          amount: "1",
          earnedAt: "2024-07-01T00:00:00.000Z",
        },
      ],
      walletAddress: "0xabc",
      chainId: 10143,
    });
    expect(result.profileId).toBe("p1");
    expect(result.eventCount).toBe(1);
  });

  it("persistSourceSync fails when delete errors", async () => {
    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "p1" }, error: null }),
            }),
          }),
        };
      }
      if (table === "earn_events") {
        return {
          delete: () => ({
            eq: () => ({
              eq: async () => ({ error: { message: "delete failed" } }),
            }),
          }),
        };
      }
      return {};
    });
    const { persistSourceSync, LedgerPersistError } = await import(
      "../../web/src/lib/ledger-db"
    );
    await expect(
      persistSourceSync({
        userId: "u1",
        source: "okx",
        status: "ok",
        events: [],
      }),
    ).rejects.toBeInstanceOf(LedgerPersistError);
  });

  it("persistSourceSync creates profile when missing", async () => {
    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: async () => ({ data: { id: "p-new" }, error: null }),
            }),
          }),
        };
      }
      if (table === "earn_events") {
        return {
          delete: () => ({
            eq: () => ({
              eq: async () => ({ error: null }),
            }),
          }),
        };
      }
      if (table === "source_connections") {
        return { upsert: async () => ({ error: null }) };
      }
      if (table === "sync_runs") {
        return { insert: async () => ({ error: null }) };
      }
      return {};
    });
    const { persistSourceSync } = await import("../../web/src/lib/ledger-db");
    const result = await persistSourceSync({
      userId: "u-new",
      source: "lunc_stake",
      status: "ok",
      events: [],
    });
    expect(result.profileId).toBe("p-new");
  });

  it("loadDbLedger returns empty snapshot without profile", async () => {
    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      return {};
    });
    const { loadDbLedger } = await import("../../web/src/lib/ledger-db");
    const snap = await loadDbLedger("u-missing");
    expect(snap.events).toEqual([]);
    expect(snap.aggregates.bySource).toEqual([]);
    expect(snap.wallet).toBeNull();
    expect(snap.sources.lunc_stake.status).toBe("not_connected");
  });

  it("loadDbLedger maps events and aggregates", async () => {
    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "p1" }, error: null }),
            }),
          }),
        };
      }
      if (table === "earn_events") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => ({
                  data: [
                    {
                      id: "binance:1",
                      source: "binance",
                      asset: "USDT",
                      amount: 1.5,
                      earned_at: "2024-07-01T00:00:00.000Z",
                      raw_type: "REWARD",
                      meta: {},
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "source_connections") {
        return {
          select: () => ({
            eq: async () => ({
              data: [
                {
                  source: "binance",
                  status: "ok",
                  last_error: null,
                  last_synced_at: "2024-07-01T01:00:00.000Z",
                },
              ],
              error: null,
            }),
          }),
        };
      }
      if (table === "earn_aggregates_by_source") {
        return {
          select: () => ({
            eq: async () => ({
              data: [
                {
                  source: "binance",
                  event_count: 1,
                  total_amount: 1.5,
                  last_earned_at: "2024-07-01T00:00:00.000Z",
                },
              ],
              error: null,
            }),
          }),
        };
      }
      if (table === "earn_aggregates_by_asset") {
        return {
          select: () => ({
            eq: async () => ({
              data: [
                {
                  asset: "USDT",
                  source: "binance",
                  event_count: 1,
                  total_amount: 1.5,
                },
              ],
              error: null,
            }),
          }),
        };
      }
      if (table === "wallet_connections") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: {
                      address: "0xabc",
                      chain_id: 10143,
                      last_seen_at: "2024-07-01T01:00:00.000Z",
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });
    const { loadDbLedger } = await import("../../web/src/lib/ledger-db");
    const snap = await loadDbLedger("u1");
    expect(snap.events).toHaveLength(1);
    expect(snap.sources.binance.status).toBe("ok");
    expect(snap.aggregates.bySource[0].totalAmount).toBe("1.5");
    expect(snap.wallet?.address).toBe("0xabc");
  });

  it("persistSourceSync fails on upsert / connection / sync_run errors", async () => {
    const { LedgerPersistError, persistSourceSync } = await import(
      "../../web/src/lib/ledger-db"
    );

    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "p1" }, error: null }),
            }),
          }),
        };
      }
      if (table === "earn_events") {
        return {
          delete: () => ({
            eq: () => ({
              eq: async () => ({ error: null }),
            }),
          }),
          upsert: async () => ({ error: { message: "upsert fail" } }),
        };
      }
      return {};
    });
    await expect(
      persistSourceSync({
        userId: "u1",
        source: "binance",
        status: "ok",
        events: [
          {
            id: "x",
            source: "binance",
            asset: "USDT",
            amount: "1",
            earnedAt: "2024-07-01T00:00:00.000Z",
          },
        ],
      }),
    ).rejects.toThrow(/earn events/i);

    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "p1" }, error: null }),
            }),
          }),
        };
      }
      if (table === "earn_events") {
        return {
          delete: () => ({
            eq: () => ({
              eq: async () => ({ error: null }),
            }),
          }),
        };
      }
      if (table === "source_connections") {
        return { upsert: async () => ({ error: { message: "conn" } }) };
      }
      return {};
    });
    await expect(
      persistSourceSync({
        userId: "u1",
        source: "okx",
        status: "ok",
        events: [],
      }),
    ).rejects.toBeInstanceOf(LedgerPersistError);

    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "p1" }, error: null }),
            }),
          }),
        };
      }
      if (table === "earn_events") {
        return {
          delete: () => ({
            eq: () => ({
              eq: async () => ({ error: null }),
            }),
          }),
        };
      }
      if (table === "source_connections") {
        return { upsert: async () => ({ error: null }) };
      }
      if (table === "sync_runs") {
        return { insert: async () => ({ error: { message: "run" } }) };
      }
      return {};
    });
    await expect(
      persistSourceSync({
        userId: "u1",
        source: "lunc_stake",
        status: "ok",
        events: [],
      }),
    ).rejects.toThrow(/sync_run/i);
  });

  it("loadDbLedger fails when not configured or query errors", async () => {
    isAdminConfigured.mockReturnValue(false);
    const { loadDbLedger, LedgerPersistError } = await import(
      "../../web/src/lib/ledger-db"
    );
    await expect(loadDbLedger("u1")).rejects.toBeInstanceOf(LedgerPersistError);

    isAdminConfigured.mockReturnValue(true);
    from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: null,
            error: { message: "boom" },
          }),
        }),
      }),
    }));
    await expect(loadDbLedger("u1")).rejects.toThrow(/boom/);
  });
});
