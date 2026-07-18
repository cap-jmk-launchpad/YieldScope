import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  LuncAdapterError,
  crawlWithdrawRewardTxs,
  denomToAsset,
  estimateHeightAt,
  fetchLuncStakeEarnEvents,
  luncHistoryChunks,
  microToHuman,
  normalizeLuncRewards,
  normalizeWithdrawRewardTx,
  normalizeWithdrawRewardTxs,
  parseCoinList,
  parseLuncAddress,
} from "../../web/src/lib/adapters/lunc-stake";
import { CEX_TRANSPORT_MAX_SPAN_MS } from "../../web/src/lib/sync-range";

const root = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/lunc");
const ADDR = "terra1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a";

function load(name: string) {
  return JSON.parse(readFileSync(join(root, name), "utf8"));
}

describe("LUNC (Terra Classic) stake adapter", () => {
  it("parses raw terra1 address", () => {
    expect(parseLuncAddress(ADDR)).toBe(ADDR);
  });

  it("parses address from explorer URL", () => {
    const url = `https://finder.terra.money/classic/address/${ADDR}`;
    expect(parseLuncAddress(url)).toBe(ADDR);
  });

  it("rejects invalid input", () => {
    expect(() => parseLuncAddress("0xabc")).toThrow(LuncAdapterError);
    expect(() => parseLuncAddress("")).toThrow(LuncAdapterError);
  });

  it("maps denoms and micro amounts", () => {
    expect(denomToAsset("uluna")).toBe("LUNC");
    expect(denomToAsset("uusd")).toBe("USTC");
    expect(microToHuman("1234567890")).toBe("1234.56789");
    expect(microToHuman("1000000")).toBe("1");
    // Dust / fractional micros must not round to 0 via float+toFixed
    expect(microToHuman("1")).toBe("0.000001");
    expect(microToHuman("0.000000001")).toBe("0.000000000000001");
  });

  it("parses withdraw event coin lists", () => {
    expect(parseCoinList("")).toEqual([]);
    expect(parseCoinList("131728628uluna,418681uusd")).toEqual([
      { amount: "131728628", denom: "uluna" },
      { amount: "418681", denom: "uusd" },
    ]);
    expect(() => parseCoinList("notaCoin")).toThrow(LuncAdapterError);
  });

  it("normalizes pending rewards from fixture via LCD totals", () => {
    const events = normalizeLuncRewards(ADDR, load("rewards-sample.json"), new Date("2024-07-01T00:00:00Z"));
    // Fixture has totals — prefer one row per denom over validator×denom.
    expect(events.length).toBe(2);
    expect(events.every((e) => e.source === "lunc_stake")).toBe(true);
    expect(events.every((e) => e.rawType === "pending_total_reward")).toBe(true);
    expect(events.find((e) => e.asset === "LUNC")?.amount).toBe("1235.56789");
    expect(events.some((e) => e.asset === "USTC")).toBe(true);
    expect(events.every((e) => e.id.includes(":total:"))).toBe(true);
    expect(events.every((e) => e.meta?.kind === "pending")).toBe(true);
  });

  it("falls back to per-validator when totals absent", () => {
    const events = normalizeLuncRewards(
      ADDR,
      {
        rewards: [
          {
            validator_address: "terravaloper1abc",
            reward: [{ denom: "uluna", amount: "1000000" }],
          },
          {
            validator_address: "terravaloper1def",
            reward: [{ denom: "uluna", amount: "2000000" }],
          },
        ],
      },
      new Date("2024-07-01T00:00:00Z"),
    );
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.rawType === "pending_delegation_reward")).toBe(
      true,
    );
    expect(events.map((e) => e.amount).sort()).toEqual(["1", "2"]);
  });

  it("returns empty for empty rewards", () => {
    expect(normalizeLuncRewards(ADDR, load("rewards-empty.json"))).toEqual([]);
  });

  it("fails closed on malformed payload", () => {
    expect(() =>
      normalizeLuncRewards(ADDR, {
        rewards: [{ validator_address: "", reward: [] }],
      }),
    ).toThrow(LuncAdapterError);
  });

  it("normalizes claimed withdraw txs from fixture with real earnedAt", () => {
    const fixture = load("withdraw-txs-sample.json");
    const events = normalizeWithdrawRewardTxs(ADDR, fixture.tx_responses);
    // Failed tx (code=1) skipped; two successful txs → 3 uluna + 1 ustc rows
    expect(events.every((e) => e.rawType === "withdraw_delegator_reward")).toBe(
      true,
    );
    expect(events.every((e) => e.meta?.kind === "claimed")).toBe(true);
    expect(events.some((e) => e.earnedAt === "2026-07-17T12:05:07Z")).toBe(true);
    expect(events.some((e) => e.earnedAt === "2026-06-01T12:00:00Z")).toBe(true);
    expect(events.find((e) => e.amount === "131.728628")).toBeTruthy();
    expect(events.find((e) => e.amount === "192.292315")).toBeTruthy();
    expect(events.find((e) => e.amount === "1" && e.earnedAt.startsWith("2026-06"))).toBeTruthy();
    expect(events.some((e) => e.amount.includes("999"))).toBe(false);
  });

  it("skips failed txs and other-delegator withdraw events", () => {
    expect(
      normalizeWithdrawRewardTx(ADDR, {
        txhash: "AA",
        code: 5,
        timestamp: "2026-01-01T00:00:00Z",
        events: [
          {
            type: "withdraw_rewards",
            attributes: [
              { key: "amount", value: "1000000uluna" },
              { key: "delegator", value: ADDR },
            ],
          },
        ],
      }),
    ).toEqual([]);

    expect(
      normalizeWithdrawRewardTx(ADDR, {
        txhash: "BB",
        code: 0,
        timestamp: "2026-01-01T00:00:00Z",
        events: [
          {
            type: "withdraw_rewards",
            attributes: [
              { key: "amount", value: "1000000uluna" },
              {
                key: "delegator",
                value: "terra1differentqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
              },
            ],
          },
        ],
      }),
    ).toEqual([]);
  });

  it("estimateHeightAt and history chunks", () => {
    const latest = { height: 1_000_000, timeMs: Date.parse("2026-07-01T00:00:00Z") };
    expect(estimateHeightAt(latest.timeMs, latest)).toBe(1_000_000);
    expect(
      estimateHeightAt(latest.timeMs - 60_000, latest, 6000),
    ).toBe(1_000_000 - 10);
    const chunks = luncHistoryChunks(
      Date.parse("2026-01-01T00:00:00Z"),
      Date.parse("2026-07-01T00:00:00Z"),
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].endMs - chunks[0].startMs).toBeLessThanOrEqual(
      CEX_TRANSPORT_MAX_SPAN_MS,
    );
  });

  it("crawlWithdrawRewardTxs paginates until empty", async () => {
    const page1 = load("withdraw-txs-sample.json");
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tx_responses: page1.tx_responses.slice(0, 1) }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tx_responses: [] }),
      });
    const txs = await crawlWithdrawRewardTxs(ADDR, {
      lcdUrl: "https://lcd.example",
      heightMin: 1,
      heightMax: 99_999_999,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(txs).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const firstUrl = String(fetchImpl.mock.calls[0][0]);
    expect(firstUrl).toContain("withdraw_rewards.delegator");
    expect(firstUrl).toContain("page=1");
  });

  it("fetchLuncStakeEarnEvents crawls history + pending", async () => {
    process.env.LUNC_TX_PAGE_PAUSE_MS = "0";
    const withdraw = load("withdraw-txs-sample.json");
    const rewards = load("rewards-sample.json");
    const nowMs = Date.parse("2026-07-18T00:00:00Z");
    const latestBlock = {
      height: 29_550_000,
      timeMs: nowMs,
    };

    const fetchImpl = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/blocks/latest")) {
        return {
          ok: true,
          json: async () => ({
            block: {
              header: {
                height: String(latestBlock.height),
                time: new Date(latestBlock.timeMs).toISOString(),
              },
            },
          }),
        };
      }
      if (u.includes("/cosmos/tx/v1beta1/txs")) {
        // Only return txs on page 1 so pagination stops cleanly.
        if (u.includes("page=1")) {
          return { ok: true, json: async () => withdraw };
        }
        return { ok: true, json: async () => ({ tx_responses: [] }) };
      }
      if (u.includes("/delegators/") && u.includes("/rewards")) {
        return { ok: true, json: async () => rewards };
      }
      return { ok: false, status: 404 };
    });

    const events = await fetchLuncStakeEarnEvents(ADDR, {
      lcdUrl: "https://lcd.example",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startMs: Date.parse("2026-06-01T00:00:00Z"),
      endMs: nowMs,
      nowMs,
      latestBlock,
    });

    const claimed = events.filter((e) => e.rawType === "withdraw_delegator_reward");
    const pending = events.filter((e) => e.rawType === "pending_total_reward");
    expect(claimed.length).toBeGreaterThanOrEqual(3);
    expect(pending.length).toBe(2);
    expect(claimed.some((e) => e.meta?.txhash?.endsWith("00FF"))).toBe(false);
    delete process.env.LUNC_TX_PAGE_PAUSE_MS;
  });

  it("fetchLuncStakeEarnEvents omits pending for past-only windows", async () => {
    process.env.LUNC_TX_PAGE_PAUSE_MS = "0";
    const withdraw = load("withdraw-txs-sample.json");
    const fetchImpl = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/blocks/latest")) {
        return {
          ok: true,
          json: async () => ({
            block: {
              header: {
                height: "29550000",
                time: "2026-07-18T00:00:00.000Z",
              },
            },
          }),
        };
      }
      if (u.includes("/cosmos/tx/v1beta1/txs")) {
        if (u.includes("page=1")) {
          return { ok: true, json: async () => withdraw };
        }
        return { ok: true, json: async () => ({ tx_responses: [] }) };
      }
      throw new Error(`unexpected fetch ${u}`);
    });

    const events = await fetchLuncStakeEarnEvents(ADDR, {
      lcdUrl: "https://lcd.example",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startMs: Date.parse("2026-06-01T00:00:00Z"),
      endMs: Date.parse("2026-06-30T23:59:59.999Z"),
      nowMs: Date.parse("2026-07-18T00:00:00Z"),
      latestBlock: {
        height: 29_550_000,
        timeMs: Date.parse("2026-07-18T00:00:00Z"),
      },
    });
    expect(events.every((e) => e.rawType === "withdraw_delegator_reward")).toBe(
      true,
    );
    expect(events).toHaveLength(1);
    expect(events[0].amount).toBe("1");
    delete process.env.LUNC_TX_PAGE_PAUSE_MS;
  });

  it("fetch fails closed on HTTP error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "" });
    await expect(
      fetchLuncStakeEarnEvents(ADDR, {
        lcdUrl: "https://lcd.example",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        includePending: false,
        latestBlock: { height: 100, timeMs: Date.now() },
        startMs: Date.now() - 1000,
        endMs: Date.now(),
      }),
    ).rejects.toThrow(/LCD HTTP 500/);
  });

  it("emits total rewards when per-validator empty", () => {
    const events = normalizeLuncRewards(ADDR, {
      rewards: [],
      total: [{ denom: "uluna", amount: "2000000" }],
    });
    expect(events).toHaveLength(1);
    expect(events[0].id).toContain(":total:");
    expect(events[0].amount).toBe("2");
  });

  it("skips zero amounts and maps u-denoms", () => {
    expect(denomToAsset("ufoo")).toBe("FOO");
    expect(denomToAsset("ibc/ABC")).toBe("IBC/ABC");
    const events = normalizeLuncRewards(ADDR, {
      rewards: [
        {
          validator_address: "terravaloper1abc",
          reward: [{ denom: "uluna", amount: "0" }],
        },
      ],
      total: [],
    });
    expect(events).toEqual([]);
  });

  it("microToHuman rejects bad amounts", () => {
    expect(() => microToHuman("nope")).toThrow(LuncAdapterError);
  });

  it("parses address from query params and rejects malformed totals", () => {
    expect(
      parseLuncAddress(`https://finder.terra.money/classic?address=${ADDR}`),
    ).toBe(ADDR);
    expect(
      parseLuncAddress(`https://example.com/?account=${ADDR}`),
    ).toBe(ADDR);
    expect(() =>
      normalizeLuncRewards(ADDR, {
        rewards: [],
        total: [{ denom: "", amount: "1" }],
      }),
    ).toThrow(LuncAdapterError);
    expect(() =>
      normalizeLuncRewards(ADDR, {
        rewards: [
          {
            validator_address: "terravaloper1abc",
            reward: [{ denom: "uluna", amount: null as unknown as string }],
          },
        ],
      }),
    ).toThrow(LuncAdapterError);
  });
});
