/**
 * Pure rollup math mirroring refresh_earn_aggregates_for_profile SQL.
 * Used to assert merge/replace semantics stay correct without a live DB.
 */
import { describe, expect, it } from "vitest";

type SourceId = "binance" | "okx" | "monad_stake" | "lunc_stake";

interface EarnEventLike {
  id: string;
  source: SourceId;
  asset: string;
  amount: string;
  earnedAt: string;
}

interface BySourceRow {
  source: SourceId;
  eventCount: number;
  totalAmount: number;
  firstEarnedAt: string;
  lastEarnedAt: string;
}

interface ByAssetRow {
  asset: string;
  source: SourceId;
  eventCount: number;
  totalAmount: number;
}

interface DailyRow {
  source: SourceId;
  asset: string;
  day: string;
  eventCount: number;
  totalAmount: number;
}

function utcDay(iso: string): string {
  return iso.slice(0, 10);
}

/** Mirrors earn_aggregates_by_source GROUP BY profile_id, source. */
export function rollupBySource(events: EarnEventLike[]): BySourceRow[] {
  const map = new Map<SourceId, BySourceRow>();
  for (const e of events) {
    const amount = Number(e.amount);
    const cur = map.get(e.source);
    if (!cur) {
      map.set(e.source, {
        source: e.source,
        eventCount: 1,
        totalAmount: amount,
        firstEarnedAt: e.earnedAt,
        lastEarnedAt: e.earnedAt,
      });
      continue;
    }
    cur.eventCount += 1;
    cur.totalAmount += amount;
    if (e.earnedAt < cur.firstEarnedAt) cur.firstEarnedAt = e.earnedAt;
    if (e.earnedAt > cur.lastEarnedAt) cur.lastEarnedAt = e.earnedAt;
  }
  return [...map.values()].sort((a, b) => a.source.localeCompare(b.source));
}

/** Mirrors earn_aggregates_by_asset GROUP BY profile_id, asset, source. */
export function rollupByAsset(events: EarnEventLike[]): ByAssetRow[] {
  const map = new Map<string, ByAssetRow>();
  for (const e of events) {
    const key = `${e.asset}|${e.source}`;
    const amount = Number(e.amount);
    const cur = map.get(key);
    if (!cur) {
      map.set(key, {
        asset: e.asset,
        source: e.source,
        eventCount: 1,
        totalAmount: amount,
      });
      continue;
    }
    cur.eventCount += 1;
    cur.totalAmount += amount;
  }
  return [...map.values()].sort(
    (a, b) =>
      a.asset.localeCompare(b.asset) || a.source.localeCompare(b.source),
  );
}

/** Mirrors earn_daily_by_asset GROUP BY profile, source, asset, UTC day. */
export function rollupDaily(events: EarnEventLike[]): DailyRow[] {
  const map = new Map<string, DailyRow>();
  for (const e of events) {
    const day = utcDay(e.earnedAt);
    const key = `${e.source}|${e.asset}|${day}`;
    const amount = Number(e.amount);
    const cur = map.get(key);
    if (!cur) {
      map.set(key, {
        source: e.source,
        asset: e.asset,
        day,
        eventCount: 1,
        totalAmount: amount,
      });
      continue;
    }
    cur.eventCount += 1;
    cur.totalAmount += amount;
  }
  return [...map.values()].sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      a.source.localeCompare(b.source) ||
      a.asset.localeCompare(b.asset),
  );
}

/**
 * Simulate persist modes against an in-memory event set (same rules as
 * persistSourceSync), then recompute aggregates — what the SQL refresh does
 * after every write.
 */
function applyPersist(
  existing: EarnEventLike[],
  input: {
    source: SourceId;
    events: EarnEventLike[];
    persistMode: "replace" | "merge" | "upsert";
    mergeFromMs?: number;
    mergeToMs?: number;
  },
): EarnEventLike[] {
  let next = [...existing];
  if (input.persistMode === "replace") {
    next = next.filter((e) => e.source !== input.source);
  } else if (
    input.persistMode === "merge" &&
    input.mergeFromMs != null &&
    input.mergeToMs != null
  ) {
    next = next.filter((e) => {
      if (e.source !== input.source) return true;
      const ms = Date.parse(e.earnedAt);
      return ms < input.mergeFromMs! || ms > input.mergeToMs!;
    });
  }
  // upsert / after delete: upsert by id
  const byId = new Map(next.map((e) => [e.id, e]));
  for (const e of input.events) byId.set(e.id, e);
  return [...byId.values()];
}

describe("earn aggregate rollups (post-persist semantics)", () => {
  it("replace rebuilds full-profile aggregates from remaining + new events", () => {
    const existing: EarnEventLike[] = [
      {
        id: "binance:old",
        source: "binance",
        asset: "USDT",
        amount: "10",
        earnedAt: "2022-01-01T00:00:00.000Z",
      },
      {
        id: "okx:keep",
        source: "okx",
        asset: "BTC",
        amount: "0.1",
        earnedAt: "2023-06-01T12:00:00.000Z",
      },
    ];
    const after = applyPersist(existing, {
      source: "binance",
      persistMode: "replace",
      events: [
        {
          id: "binance:new",
          source: "binance",
          asset: "USDT",
          amount: "3",
          earnedAt: "2024-07-01T00:00:00.000Z",
        },
        {
          id: "binance:new2",
          source: "binance",
          asset: "ETH",
          amount: "1",
          earnedAt: "2024-07-02T00:00:00.000Z",
        },
      ],
    });

    expect(rollupBySource(after)).toEqual([
      {
        source: "binance",
        eventCount: 2,
        totalAmount: 4,
        firstEarnedAt: "2024-07-01T00:00:00.000Z",
        lastEarnedAt: "2024-07-02T00:00:00.000Z",
      },
      {
        source: "okx",
        eventCount: 1,
        totalAmount: 0.1,
        firstEarnedAt: "2023-06-01T12:00:00.000Z",
        lastEarnedAt: "2023-06-01T12:00:00.000Z",
      },
    ]);
    expect(rollupByAsset(after)).toEqual([
      { asset: "BTC", source: "okx", eventCount: 1, totalAmount: 0.1 },
      { asset: "ETH", source: "binance", eventCount: 1, totalAmount: 1 },
      { asset: "USDT", source: "binance", eventCount: 1, totalAmount: 3 },
    ]);
  });

  it("merge window keeps outside rows so first_earned_at stays historical", () => {
    const existing: EarnEventLike[] = [
      {
        id: "binance:2022",
        source: "binance",
        asset: "USDT",
        amount: "5",
        earnedAt: "2022-03-01T00:00:00.000Z",
      },
      {
        id: "binance:jul-old",
        source: "binance",
        asset: "USDT",
        amount: "2",
        earnedAt: "2024-07-15T00:00:00.000Z",
      },
      {
        id: "lunc:1",
        source: "lunc_stake",
        asset: "LUNC",
        amount: "100",
        earnedAt: "2021-01-01T00:00:00.000Z",
      },
    ];
    const after = applyPersist(existing, {
      source: "binance",
      persistMode: "merge",
      mergeFromMs: Date.parse("2024-07-01T00:00:00.000Z"),
      mergeToMs: Date.parse("2024-07-31T23:59:59.999Z"),
      events: [
        {
          id: "binance:jul-new",
          source: "binance",
          asset: "USDT",
          amount: "7",
          earnedAt: "2024-07-20T00:00:00.000Z",
        },
      ],
    });

    const bySource = rollupBySource(after);
    const binance = bySource.find((r) => r.source === "binance")!;
    expect(binance.eventCount).toBe(2);
    expect(binance.totalAmount).toBe(12); // 5 + 7
    expect(binance.firstEarnedAt).toBe("2022-03-01T00:00:00.000Z");
    expect(binance.lastEarnedAt).toBe("2024-07-20T00:00:00.000Z");

    const lunc = bySource.find((r) => r.source === "lunc_stake")!;
    expect(lunc.totalAmount).toBe(100);

    expect(rollupDaily(after)).toEqual([
      {
        source: "lunc_stake",
        asset: "LUNC",
        day: "2021-01-01",
        eventCount: 1,
        totalAmount: 100,
      },
      {
        source: "binance",
        asset: "USDT",
        day: "2022-03-01",
        eventCount: 1,
        totalAmount: 5,
      },
      {
        source: "binance",
        asset: "USDT",
        day: "2024-07-20",
        eventCount: 1,
        totalAmount: 7,
      },
    ]);
  });

  it("lunc history crawl upsert appends without wiping other sources", () => {
    const existing: EarnEventLike[] = [
      {
        id: "binance:1",
        source: "binance",
        asset: "USDT",
        amount: "1",
        earnedAt: "2024-01-01T00:00:00.000Z",
      },
    ];
    const after = applyPersist(existing, {
      source: "lunc_stake",
      persistMode: "upsert",
      events: [
        {
          id: "lunc:a",
          source: "lunc_stake",
          asset: "LUNC",
          amount: "10",
          earnedAt: "2020-05-01T00:00:00.000Z",
        },
        {
          id: "lunc:b",
          source: "lunc_stake",
          asset: "LUNC",
          amount: "20",
          earnedAt: "2020-05-02T12:00:00.000Z",
        },
      ],
    });

    expect(rollupBySource(after)).toEqual([
      {
        source: "binance",
        eventCount: 1,
        totalAmount: 1,
        firstEarnedAt: "2024-01-01T00:00:00.000Z",
        lastEarnedAt: "2024-01-01T00:00:00.000Z",
      },
      {
        source: "lunc_stake",
        eventCount: 2,
        totalAmount: 30,
        firstEarnedAt: "2020-05-01T00:00:00.000Z",
        lastEarnedAt: "2020-05-02T12:00:00.000Z",
      },
    ]);
    expect(rollupDaily(after).map((r) => r.day)).toEqual([
      "2020-05-01",
      "2020-05-02",
      "2024-01-01",
    ]);
  });
});
