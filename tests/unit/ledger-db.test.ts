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
    expect(snap.eventsTotal).toBe(0);
    expect(snap.eventsMode).toBe("all");
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
                range: async () => ({
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
                  last_error: "stale should be ignored",
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
                  first_earned_at: "2024-07-01T00:00:00.000Z",
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
    expect(snap.eventsTotal).toBe(1);
    expect(snap.eventsMode).toBe("all");
    expect(snap.sources.binance.status).toBe("ok");
    expect(snap.sources.binance.error).toBeUndefined();
    expect(snap.sources.binance.eventCount).toBe(1);
    expect(snap.aggregates.bySource[0].totalAmount).toBe("1.5");
    expect(snap.aggregates.bySource[0].firstEarnedAt).toBe(
      "2024-07-01T00:00:00.000Z",
    );
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

  it("persistSourceSync merge mode deletes only the window", async () => {
    const gte = vi.fn(() => ({
      lte: async () => ({ error: null }),
    }));
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
              eq: () => ({ gte }),
            }),
          }),
          upsert: async () => ({ error: null }),
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
    await persistSourceSync({
      userId: "u1",
      source: "binance",
      status: "ok",
      events: [],
      mergeFromMs: Date.parse("2024-07-01T00:00:00.000Z"),
      mergeToMs: Date.parse("2024-07-31T23:59:59.999Z"),
      persistMode: "merge",
    });
    expect(gte).toHaveBeenCalled();
  });

  it("persistSourceSync upsert mode skips delete", async () => {
    const del = vi.fn();
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
          delete: del,
          upsert: async () => ({ error: null }),
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
    await persistSourceSync({
      userId: "u1",
      source: "okx",
      status: "ok",
      events: [
        {
          id: "okx:1",
          source: "okx",
          asset: "USDT",
          amount: "1",
          earnedAt: "2024-07-01T00:00:00.000Z",
        },
      ],
      persistMode: "upsert",
    });
    expect(del).not.toHaveBeenCalled();
  });

  it("persistSourceSync chunks earn event upserts", async () => {
    const upsert = vi.fn(async () => ({ error: null }));
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
          upsert,
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
    const events = Array.from({ length: 501 }, (_, i) => ({
      id: `binance:${i}`,
      source: "binance" as const,
      asset: "USDT",
      amount: "1",
      earnedAt: "2024-07-01T00:00:00.000Z",
    }));
    await persistSourceSync({
      userId: "u1",
      source: "binance",
      status: "ok",
      events,
    });
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls[0]![0]).toHaveLength(500);
    expect(upsert.mock.calls[1]![0]).toHaveLength(1);
  });

  it("persistSourceSync fails on wallet / profile wallet errors", async () => {
    const { persistSourceSync, LedgerPersistError } = await import(
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
        };
      }
      if (table === "source_connections") {
        return { upsert: async () => ({ error: null }) };
      }
      if (table === "sync_runs") {
        return { insert: async () => ({ error: null }) };
      }
      if (table === "wallet_connections") {
        return { upsert: async () => ({ error: { message: "wallet boom" } }) };
      }
      return {};
    });
    await expect(
      persistSourceSync({
        userId: "u1",
        source: "monad_stake",
        status: "ok",
        events: [],
        walletAddress: "0xABC",
      }),
    ).rejects.toThrow(/wallet connection/i);

    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "p1" }, error: null }),
            }),
          }),
          update: () => ({
            eq: async () => ({ error: { message: "profile wallet" } }),
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
      if (table === "wallet_connections") {
        return { upsert: async () => ({ error: null }) };
      }
      return {};
    });
    await expect(
      persistSourceSync({
        userId: "u1",
        source: "monad_stake",
        status: "ok",
        events: [],
        walletAddress: "0xabc",
        chainId: 10143,
      }),
    ).rejects.toBeInstanceOf(LedgerPersistError);
  });

  it("ensureProfileId fails on select / insert errors", async () => {
    const { ensureProfileId, LedgerPersistError } = await import(
      "../../web/src/lib/ledger-db"
    );
    from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: null,
            error: { message: "select fail" },
          }),
        }),
      }),
    }));
    await expect(ensureProfileId("u1")).rejects.toThrow(/Profile lookup/);

    from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
      insert: () => ({
        select: () => ({
          single: async () => ({
            data: null,
            error: { message: "insert fail" },
          }),
        }),
      }),
    }));
    await expect(ensureProfileId("u1", "a@b.c")).rejects.toBeInstanceOf(
      LedgerPersistError,
    );
  });

  it("getSourceHighWaterMs covers null / error / valid paths", async () => {
    const { getSourceHighWaterMs, LedgerPersistError } = await import(
      "../../web/src/lib/ledger-db"
    );
    isAdminConfigured.mockReturnValue(false);
    expect(await getSourceHighWaterMs("u1", "binance")).toBeNull();

    isAdminConfigured.mockReturnValue(true);
    from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: null,
            error: { message: "p fail" },
          }),
        }),
      }),
    }));
    await expect(getSourceHighWaterMs("u1", "binance")).rejects.toThrow(
      /Profile lookup/,
    );

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
    expect(await getSourceHighWaterMs("u1", "binance")).toBeNull();

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
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: null,
                      error: { message: "hw fail" },
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });
    await expect(getSourceHighWaterMs("u1", "okx")).rejects.toBeInstanceOf(
      LedgerPersistError,
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
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: { earned_at: "2024-07-01T00:00:00.000Z" },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });
    expect(await getSourceHighWaterMs("u1", "binance")).toBe(
      Date.parse("2024-07-01T00:00:00.000Z"),
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
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: { earned_at: null },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });
    expect(await getSourceHighWaterMs("u1", "binance")).toBeNull();
  });

  it("listDistinctEarnAssets lists unique tickers", async () => {
    const { listDistinctEarnAssets, LedgerPersistError } = await import(
      "../../web/src/lib/ledger-db"
    );
    isAdminConfigured.mockReturnValue(false);
    await expect(listDistinctEarnAssets()).rejects.toBeInstanceOf(
      LedgerPersistError,
    );

    isAdminConfigured.mockReturnValue(true);
    from.mockImplementation(() => ({
      select: async () => ({
        data: null,
        error: { message: "list fail" },
      }),
    }));
    await expect(listDistinctEarnAssets()).rejects.toThrow(/earn assets/);

    from.mockImplementation(() => ({
      select: async () => ({
        data: [
          { asset: " usdt " },
          { asset: "BTC" },
          { asset: "" },
          { asset: "btc" },
          { asset: null },
        ],
        error: null,
      }),
    }));
    expect(await listDistinctEarnAssets()).toEqual(["BTC", "USDT"]);
  });

  it("loadDbLedger maps null wallet and unknown sources", async () => {
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
                range: async () => ({
                  data: [
                    {
                      id: "x",
                      source: "binance",
                      asset: "USDT",
                      amount: 1,
                      earned_at: "2024-07-01T00:00:00.000Z",
                      raw_type: null,
                      meta: null,
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
                  source: "unknown_src",
                  status: "ok",
                  last_error: "e",
                  last_synced_at: null,
                },
                {
                  source: "okx",
                  status: "error",
                  last_error: "bad",
                  last_synced_at: "2024-07-01T00:00:00.000Z",
                },
              ],
              error: null,
            }),
          }),
        };
      }
      if (
        table === "earn_aggregates_by_source" ||
        table === "earn_aggregates_by_asset"
      ) {
        return {
          select: () => ({
            eq: async () => ({ data: [], error: null }),
          }),
        };
      }
      if (table === "wallet_connections") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
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
    expect(snap.wallet).toBeNull();
    expect(snap.sources.okx.status).toBe("error");
    expect(snap.sources.okx.error).toBe("bad");
    expect(snap.events[0].rawType).toBeUndefined();
  });

  it("loadDbLedger pages beyond 500 events (no hard cap)", async () => {
    const pageCalls: Array<[number, number]> = [];
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
                range: async (fromIdx: number, toIdx: number) => {
                  pageCalls.push([fromIdx, toIdx]);
                  if (fromIdx === 0) {
                    return {
                      data: Array.from({ length: 1000 }, (_, i) => ({
                        id: `binance:${i}`,
                        source: "binance",
                        asset: "USDT",
                        amount: "1",
                        earned_at: "2024-07-01T00:00:00.000Z",
                        raw_type: null,
                        meta: {},
                      })),
                      error: null,
                    };
                  }
                  if (fromIdx === 1000) {
                    return {
                      data: Array.from({ length: 50 }, (_, i) => ({
                        id: `binance:${1000 + i}`,
                        source: "binance",
                        asset: "USDT",
                        amount: "1",
                        earned_at: "2024-06-01T00:00:00.000Z",
                        raw_type: null,
                        meta: {},
                      })),
                      error: null,
                    };
                  }
                  return { data: [], error: null };
                },
              }),
            }),
          }),
        };
      }
      if (table === "source_connections") {
        return {
          select: () => ({
            eq: async () => ({ data: [], error: null }),
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
                  event_count: 1050,
                  total_amount: 1050,
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
            eq: async () => ({ data: [], error: null }),
          }),
        };
      }
      if (table === "wallet_connections") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
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
    expect(snap.events).toHaveLength(1050);
    expect(pageCalls[0]).toEqual([0, 999]);
    expect(pageCalls[1]).toEqual([1000, 1999]);
    expect(snap.sources.binance.eventCount).toBe(1050);
  });

  it("covers merge-default persistMode, nullish aggregates, and errors", async () => {
    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "p1" }, error: null }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      if (table === "earn_events") {
        return {
          delete: () => ({
            eq: () => ({
              eq: () => ({
                gte: () => ({
                  lte: async () => ({ error: null }),
                }),
              }),
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
    const {
      persistSourceSync,
      ensureProfileId,
      loadDbLedger,
      LedgerPersistError,
      getSourceHighWaterMs,
    } = await import("../../web/src/lib/ledger-db");

    await persistSourceSync({
      userId: "u1",
      source: "binance",
      status: "error",
      events: [],
      mergeFromMs: Date.parse("2024-07-01T00:00:00.000Z"),
      mergeToMs: Date.parse("2024-07-31T23:59:59.999Z"),
    });

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
              single: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      return {};
    });
    await expect(ensureProfileId("u-new")).rejects.toThrow(/unknown/);

    // Non-finite high water
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
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: { earned_at: "not-a-date" },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });
    expect(await getSourceHighWaterMs("u1", "binance")).toBeNull();

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
      if (table === "source_connections") {
        return {
          select: () => ({
            eq: async () => ({
              data: [
                {
                  source: "binance",
                  status: "error",
                  last_error: null,
                  last_synced_at: null,
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
                    data: null,
                    error: { message: "wallet q" },
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: async () => ({ data: [], error: null }),
        }),
      };
    });
    await expect(loadDbLedger("u1")).rejects.toBeInstanceOf(LedgerPersistError);
  });

  it("loadDbLedger nullish aggregates and source error rows", async () => {
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
      if (table === "source_connections") {
        return {
          select: () => ({
            eq: async () => ({
              data: null,
              error: null,
            }),
          }),
        };
      }
      if (table === "earn_aggregates_by_source") {
        return {
          select: () => ({
            eq: async () => ({
              data: null,
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
                  total_amount: null,
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
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "earn_events") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                range: async () => ({ data: null, error: null }),
              }),
            }),
          }),
        };
      }
      return {};
    });
    const { loadDbLedger } = await import("../../web/src/lib/ledger-db");
    const snap = await loadDbLedger("u1");
    expect(snap.events).toEqual([]);
    expect(snap.aggregates.bySource).toEqual([]);
    expect(snap.aggregates.byAsset[0]?.totalAmount).toBe("0");
  });

  it("loadDbLedger throws on sourcesRes and earn page errors", async () => {
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
      if (table === "source_connections") {
        return {
          select: () => ({
            eq: async () => ({
              data: null,
              error: { message: "sources boom" },
            }),
          }),
        };
      }
      if (table === "earn_aggregates_by_source") {
        return {
          select: () => ({
            eq: async () => ({ data: [], error: null }),
          }),
        };
      }
      if (table === "earn_aggregates_by_asset") {
        return {
          select: () => ({
            eq: async () => ({ data: [], error: null }),
          }),
        };
      }
      if (table === "wallet_connections") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });
    const { loadDbLedger, LedgerPersistError } = await import(
      "../../web/src/lib/ledger-db"
    );
    await expect(loadDbLedger("u1")).rejects.toBeInstanceOf(LedgerPersistError);

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
      if (table === "source_connections") {
        return {
          select: () => ({
            eq: async () => ({
              data: [
                {
                  source: "binance",
                  status: "error",
                  last_error: null,
                  last_synced_at: null,
                },
                {
                  source: "not_a_real_source",
                  status: "ok",
                  last_error: null,
                  last_synced_at: null,
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
                  event_count: 0,
                  total_amount: null,
                  last_earned_at: null,
                },
                {
                  source: "not_a_real_source",
                  event_count: 9,
                  total_amount: null,
                  last_earned_at: null,
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
            eq: async () => ({ data: null, error: null }),
          }),
        };
      }
      if (table === "wallet_connections") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "earn_events") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                range: async () => ({
                  data: null,
                  error: { message: "page boom" },
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });
    await expect(loadDbLedger("u1")).rejects.toThrow(/page boom/);

    // Successful load: error status + null last_error/synced, unknown source skipped,
    // nullish aggregate fields + unknown aggregate source
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
      if (table === "source_connections") {
        return {
          select: () => ({
            eq: async () => ({
              data: [
                {
                  source: "binance",
                  status: "error",
                  last_error: null,
                  last_synced_at: null,
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
                  event_count: 2,
                  total_amount: null,
                  last_earned_at: null,
                },
                {
                  source: "not_a_real_source",
                  event_count: 9,
                  total_amount: 1,
                  last_earned_at: null,
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
            eq: async () => ({ data: null, error: null }),
          }),
        };
      }
      if (table === "wallet_connections") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "earn_events") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                range: async () => ({ data: [], error: null }),
              }),
            }),
          }),
        };
      }
      return {};
    });
    const snap = await loadDbLedger("u1");
    expect(snap.sources.binance.eventCount).toBe(2);
    expect(snap.sources.binance.error).toBeUndefined();

    // listDistinctEarnAssets null data
    from.mockImplementation((table: string) => {
      if (table === "earn_aggregates_by_asset") {
        return {
          select: async () => ({ data: null, error: null }),
        };
      }
      return {};
    });
    const { listDistinctEarnAssets } = await import(
      "../../web/src/lib/ledger-db"
    );
    expect(await listDistinctEarnAssets()).toEqual([]);
  });

  it("loadDbLedger eventsMode=page returns one page and eventsTotal", async () => {
    const rangeCalls: Array<[number, number]> = [];
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
                range: async (fromIdx: number, toIdx: number) => {
                  rangeCalls.push([fromIdx, toIdx]);
                  return {
                    data: [
                      {
                        id: "binance:25",
                        source: "binance",
                        asset: "USDT",
                        amount: "1",
                        earned_at: "2024-07-01T00:00:00.000Z",
                        raw_type: "REWARD",
                      },
                    ],
                    error: null,
                  };
                },
              }),
            }),
          }),
        };
      }
      if (table === "source_connections") {
        return {
          select: () => ({
            eq: async () => ({ data: [], error: null }),
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
                  event_count: 100,
                  total_amount: 100,
                  first_earned_at: "2022-01-01T00:00:00.000Z",
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
            eq: async () => ({ data: [], error: null }),
          }),
        };
      }
      if (table === "wallet_connections") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });

    const { loadDbLedger } = await import("../../web/src/lib/ledger-db");
    const snap = await loadDbLedger("u1", {
      eventsMode: "page",
      eventsPage: 2,
      eventsPageSize: 25,
    });
    expect(snap.eventsMode).toBe("page");
    expect(snap.eventsPage).toBe(2);
    expect(snap.eventsPageSize).toBe(25);
    expect(snap.eventsTotal).toBe(100);
    expect(snap.events).toHaveLength(1);
    expect(snap.events[0].meta).toBeUndefined();
    expect(rangeCalls).toEqual([[25, 49]]);
  });

  it("loadDbLedger eventsMode=none skips earn_events", async () => {
    let eventsQueried = false;
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
        eventsQueried = true;
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                range: async () => ({ data: [], error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "source_connections") {
        return {
          select: () => ({
            eq: async () => ({ data: [], error: null }),
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
                  event_count: 50,
                  total_amount: 10,
                  first_earned_at: null,
                  last_earned_at: null,
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
            eq: async () => ({ data: [], error: null }),
          }),
        };
      }
      if (table === "wallet_connections") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });

    const { loadDbLedger } = await import("../../web/src/lib/ledger-db");
    const snap = await loadDbLedger("u1", { eventsMode: "none" });
    expect(eventsQueried).toBe(false);
    expect(snap.events).toEqual([]);
    expect(snap.eventsTotal).toBe(50);
    expect(snap.eventsMode).toBe("none");
  });

  it("loadDbLedger eventsMode=chart reads earn_daily_by_asset", async () => {
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
      if (table === "earn_daily_by_asset") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                range: async () => ({
                  data: [
                    {
                      source: "binance",
                      asset: "USDT",
                      day: "2024-07-01",
                      total_amount: 3.5,
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
            eq: async () => ({ data: [], error: null }),
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
                  event_count: 10,
                  total_amount: 3.5,
                  first_earned_at: "2024-07-01T00:00:00.000Z",
                  last_earned_at: "2024-07-01T12:00:00.000Z",
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
            eq: async () => ({ data: [], error: null }),
          }),
        };
      }
      if (table === "wallet_connections") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });

    const { loadDbLedger } = await import("../../web/src/lib/ledger-db");
    const snap = await loadDbLedger("u1", { eventsMode: "chart" });
    expect(snap.eventsMode).toBe("chart");
    expect(snap.events).toEqual([
      {
        id: "daily:binance:USDT:2024-07-01",
        source: "binance",
        asset: "USDT",
        amount: "3.5",
        earnedAt: "2024-07-01T00:00:00.000Z",
      },
    ]);
  });

  it("loadUserEarnAssets reads aggregates only", async () => {
    let eventsQueried = false;
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
        eventsQueried = true;
        return {};
      }
      if (table === "earn_aggregates_by_asset") {
        return {
          select: () => ({
            eq: async () => ({
              data: [{ asset: "btc" }, { asset: "USDT" }, { asset: "" }],
              error: null,
            }),
          }),
        };
      }
      return {};
    });

    const { loadUserEarnAssets } = await import("../../web/src/lib/ledger-db");
    expect(await loadUserEarnAssets("u1")).toEqual(["BTC", "USDT"]);
    expect(eventsQueried).toBe(false);
  });
});
