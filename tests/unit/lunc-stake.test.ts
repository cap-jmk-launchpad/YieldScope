import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  LuncAdapterError,
  crawlFcdAccountTxs,
  crawlWithdrawRewardTxs,
  denomToAsset,
  estimateHeightAt,
  fcdCandidates,
  fcdTxToLcdShape,
  fetchLuncStakeEarnEvents,
  lcdCandidates,
  luncHistoryChunks,
  microToHuman,
  normalizeLuncRewards,
  normalizeWithdrawRewardTx,
  normalizeWithdrawRewardTxs,
  parseCoinList,
  parseLowestHeightMessage,
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
      historySource: "lcd",
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

  it("parses addr query param and embedded terra1 in free text", () => {
    expect(
      parseLuncAddress(`https://example.com/wallet?addr=${ADDR}`),
    ).toBe(ADDR);
    // Slash prevents the bare-address fast path; invalid URL → embedded match
    expect(parseLuncAddress(`wallet/${ADDR}`)).toBe(ADDR);
  });

  it("parseCoinList skips empty tokens between commas", () => {
    expect(parseCoinList("1000000uluna,,2000000uusd")).toEqual([
      { amount: "1000000", denom: "uluna" },
      { amount: "2000000", denom: "uusd" },
    ]);
  });

  it("normalizeLuncRewards fails closed on non-object and bad micro amounts", () => {
    expect(() =>
      normalizeLuncRewards(ADDR, null as unknown as object),
    ).toThrow(/Malformed LCD rewards/);
    // Must contain a non-zero digit so isZeroDecimal does not skip first.
    expect(() =>
      normalizeLuncRewards(ADDR, {
        total: [{ denom: "uluna", amount: "12x" }],
      }),
    ).toThrow(/Bad amount/);
  });

  it("falls through zero totals to per-validator rows and optional reward arrays", () => {
    const events = normalizeLuncRewards(ADDR, {
      total: [{ denom: "uluna", amount: "0" }],
      rewards: [
        {
          validator_address: "terravaloper1abc",
          // reward omitted → ?? []
        } as { validator_address: string; reward?: { denom: string; amount: string }[] },
      ],
    });
    expect(events).toEqual([]);

    const withReward = normalizeLuncRewards(ADDR, {
      // rewards omitted → ?? []
      total: [],
    });
    expect(withReward).toEqual([]);
  });

  it("normalizeWithdrawRewardTx covers success/edge attribute paths", () => {
    // code omitted → treated as success; missing height; unknown validator;
    // empty delegator; non-withdraw events; zero amount; authz_msg_index
    const events = normalizeWithdrawRewardTx(ADDR, {
      txhash: "HASHNOHEIGHT01",
      timestamp: "2026-03-01T00:00:00Z",
      events: [
        { type: "transfer", attributes: [{ key: "amount", value: "1uluna" }] },
        {
          type: "withdraw_rewards",
          attributes: [
            { key: "amount", value: "0uluna" },
            { key: "delegator", value: ADDR },
          ],
        },
        {
          type: "withdraw_rewards",
          attributes: [
            { key: "amount", value: "5000000uluna" },
            { key: "authz_msg_index", value: "9" },
            { value: "no-key" } as { key?: string; value?: string },
            { key: "note" }, // value ?? ""
          ],
        },
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0].amount).toBe("5");
    expect(events[0].meta?.validator).toBe("unknown");
    expect(events[0].meta?.msgIndex).toBe("9");
    expect(events[0].meta?.height).toBeUndefined();

    // code as empty string → success
    expect(
      normalizeWithdrawRewardTx(ADDR, {
        txhash: "EMPTYCODE",
        code: "",
        timestamp: "2026-03-01T00:00:00Z",
        events: [
          {
            type: "withdraw_rewards",
            attributes: [
              { key: "amount", value: "1000000uluna" },
              { key: "delegator", value: "" },
            ],
          },
        ],
      }),
    ).toHaveLength(1);
  });

  it("normalizeWithdrawRewardTx fails closed on malformed inputs", () => {
    expect(() =>
      normalizeWithdrawRewardTx(ADDR, null as unknown as object),
    ).toThrow(/Malformed LCD tx/);
    expect(() =>
      normalizeWithdrawRewardTx(ADDR, {
        timestamp: "2026-01-01T00:00:00Z",
        events: [],
      }),
    ).toThrow(/missing txhash/);
    expect(() =>
      normalizeWithdrawRewardTx(ADDR, {
        txhash: "NOTIMEHASH",
        events: [],
      }),
    ).toThrow(/missing timestamp/);
    expect(() =>
      normalizeWithdrawRewardTx(ADDR, {
        txhash: "BADTIMEHASH",
        timestamp: "not-a-date",
        events: [],
      }),
    ).toThrow(/missing timestamp/);
    expect(() =>
      normalizeWithdrawRewardTx(ADDR, {
        txhash: "BADCOINHASH01",
        timestamp: "2026-01-01T00:00:00Z",
        events: [
          {
            type: "withdraw_rewards",
            attributes: [{ key: "amount", value: "notaCoin" }],
          },
        ],
      }),
    ).toThrow(LuncAdapterError);
    // Missing amount → empty coin list (no throw)
    expect(
      normalizeWithdrawRewardTx(ADDR, {
        txhash: "NOAMOUNTHASH1",
        code: null as unknown as number,
        timestamp: "2026-01-01T00:00:00Z",
        events: [{ type: "withdraw_rewards" }],
      }),
    ).toEqual([]);
    // No events array
    expect(
      normalizeWithdrawRewardTx(ADDR, {
        txhash: "NOEVENTSHASH1",
        timestamp: "2026-01-01T00:00:00Z",
      }),
    ).toEqual([]);
  });

  it("estimateHeightAt rejects bad inputs; chunks empty when inverted", () => {
    expect(() =>
      estimateHeightAt(NaN, { height: 10, timeMs: Date.now() }),
    ).toThrow(/Bad height estimate/);
    expect(() =>
      estimateHeightAt(Date.now(), { height: 10, timeMs: Date.now() }, 0),
    ).toThrow(/Bad height estimate/);
    expect(luncHistoryChunks(200, 100)).toEqual([]);
  });

  it("crawlWithdrawRewardTxs early-stops when entire page is older than startMs", async () => {
    process.env.LUNC_TX_PAGE_PAUSE_MS = "0";
    const startMs = Date.parse("2026-06-01T00:00:00Z");
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tx_responses: [
          {
            txhash: "OLD1",
            timestamp: "2026-05-01T00:00:00Z",
            code: 0,
            events: [],
          },
          {
            txhash: "OLD2",
            timestamp: "2026-05-02T00:00:00Z",
            code: 0,
            events: [],
          },
        ],
      }),
    });
    const txs = await crawlWithdrawRewardTxs(ADDR, {
      lcdUrl: "https://lcd.example",
      heightMin: 1,
      heightMax: 99,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startMs,
      endMs: Date.parse("2026-07-01T00:00:00Z"),
    });
    expect(txs.map((t) => t.txhash).sort()).toEqual(["OLD1", "OLD2"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    delete process.env.LUNC_TX_PAGE_PAUSE_MS;
  });

  it("crawlWithdrawRewardTxs skips missing hashes and timestamps without early-stop", async () => {
    process.env.LUNC_TX_PAGE_PAUSE_MS = "0";
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tx_responses: [
            {
              txhash: "KEEP",
              timestamp: "2026-07-01T00:00:00Z",
              code: 0,
              events: [],
            },
            { timestamp: "2026-07-01T00:00:00Z" }, // no hash
            { txhash: "NOTIME", code: 0, events: [] }, // no timestamp
            {
              txhash: "KEEP",
              timestamp: "2026-07-01T00:00:00Z",
              code: 0,
              events: [],
            }, // dupe
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tx_responses: [] }),
      });
    const txs = await crawlWithdrawRewardTxs(ADDR, {
      lcdUrl: "https://lcd.example",
      heightMin: 1,
      heightMax: 99,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startMs: Date.parse("2026-06-01T00:00:00Z"),
    });
    expect(txs.map((t) => t.txhash)).toEqual(["KEEP", "NOTIME"]);
    delete process.env.LUNC_TX_PAGE_PAUSE_MS;
  });

  it("crawlWithdrawRewardTxs handles page-out-of-range after a recent page", async () => {
    process.env.LUNC_TX_PAGE_PAUSE_MS = "1";
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tx_responses: [
            {
              txhash: "NEW1",
              timestamp: "2026-07-01T00:00:00Z",
              code: 0,
              events: [],
            },
            {
              txhash: "NEW1",
              timestamp: "2026-07-01T00:00:00Z",
              code: 0,
              events: [],
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "page should be within range",
      });

    const txs = await crawlWithdrawRewardTxs(ADDR, {
      lcdUrl: "https://lcd.example",
      heightMin: 1,
      heightMax: 99,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startMs: Date.parse("2026-06-01T00:00:00Z"),
      endMs: Date.parse("2026-07-10T00:00:00Z"),
    });
    expect(txs).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    delete process.env.LUNC_TX_PAGE_PAUSE_MS;
  });

  it("crawlWithdrawRewardTxs returns empty on page-out-of-range for page>1", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tx_responses: [
            {
              txhash: "P1",
              timestamp: "2026-07-01T00:00:00Z",
              code: 0,
              events: [],
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => "page should be within 1 to 1",
      });
    process.env.LUNC_TX_PAGE_PAUSE_MS = "0";
    const txs = await crawlWithdrawRewardTxs(ADDR, {
      lcdUrl: "https://lcd.example/",
      heightMin: 1,
      heightMax: 10,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(txs).toHaveLength(1);
    delete process.env.LUNC_TX_PAGE_PAUSE_MS;
  });

  it("crawlWithdrawRewardTxs stops when page yields only duplicate hashes", async () => {
    process.env.LUNC_TX_PAGE_PAUSE_MS = "0";
    const tx = {
      txhash: "SAME",
      timestamp: "2026-07-01T00:00:00Z",
      code: 0,
      events: [],
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tx_responses: [tx] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tx_responses: [tx] }),
      });
    const txs = await crawlWithdrawRewardTxs(ADDR, {
      lcdUrl: "https://lcd.example",
      heightMin: 1,
      heightMax: 10,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(txs).toHaveLength(1);
    delete process.env.LUNC_TX_PAGE_PAUSE_MS;
  });

  it("crawlWithdrawRewardTxs fails closed on hard HTTP and malformed JSON", async () => {
    await expect(
      crawlWithdrawRewardTxs(ADDR, {
        lcdUrl: "https://lcd.example",
        heightMin: 1,
        heightMax: 10,
        fetchImpl: vi.fn().mockResolvedValue({
          ok: false,
          status: 503,
          text: async () => "down",
        }) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/LCD HTTP 503/);

    await expect(
      crawlWithdrawRewardTxs(ADDR, {
        lcdUrl: "https://lcd.example",
        heightMin: 1,
        heightMax: 10,
        fetchImpl: vi.fn().mockResolvedValue({
          ok: true,
          json: async () => null,
        }) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/Malformed LCD tx search/);
  });

  it("fetchLuncStakeEarnEvents covers windows, fallback LCD, and pending merge", async () => {
    process.env.LUNC_TX_PAGE_PAUSE_MS = "0";
    process.env.LUNC_LCD_FALLBACKS = "https://lcd-fallback.example";
    const nowMs = Date.parse("2026-07-18T00:00:00Z");
    const withdraw = load("withdraw-txs-sample.json");
    const rewards = load("rewards-sample.json");

    // Primary LCD fails on latest block; fallback succeeds.
    let blockHits = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/blocks/latest")) {
        blockHits += 1;
        if (u.includes("lcd.primary")) {
          return { ok: false, status: 502, text: async () => "bad gateway" };
        }
        return {
          ok: true,
          json: async () => ({
            block: {
              header: {
                height: "29550000",
                time: new Date(nowMs).toISOString(),
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
      if (u.includes("/rewards")) {
        return { ok: true, json: async () => rewards };
      }
      return { ok: false, status: 404, text: async () => "" };
    });

    const events = await fetchLuncStakeEarnEvents(ADDR, {
      lcdUrl: "https://lcd.primary.example",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      allTime: true,
      nowMs,
      includePending: true,
    });
    expect(blockHits).toBeGreaterThanOrEqual(2);
    expect(events.some((e) => e.rawType === "pending_total_reward")).toBe(true);
    expect(events.some((e) => e.rawType === "withdraw_delegator_reward")).toBe(
      true,
    );

    // Default 90d window + explicit pending false
    const noPending = await fetchLuncStakeEarnEvents(ADDR, {
      lcdUrl: "https://lcd-fallback.example",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      nowMs,
      includePending: false,
      latestBlock: { height: 29_550_000, timeMs: nowMs },
    });
    expect(noPending.every((e) => e.meta?.kind === "claimed")).toBe(true);

    // endMs-only window (start defaults)
    const endOnly = await fetchLuncStakeEarnEvents(ADDR, {
      lcdUrl: "https://lcd-fallback.example",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      endMs: nowMs,
      nowMs,
      includePending: false,
      latestBlock: { height: 29_550_000, timeMs: nowMs },
    });
    expect(Array.isArray(endOnly)).toBe(true);

    // startMs-only
    const startOnly = await fetchLuncStakeEarnEvents(ADDR, {
      lcdUrl: "https://lcd-fallback.example",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startMs: nowMs - 7 * 24 * 60 * 60 * 1000,
      nowMs,
      includePending: false,
      latestBlock: { height: 29_550_000, timeMs: nowMs },
    });
    expect(Array.isArray(startOnly)).toBe(true);

    delete process.env.LUNC_TX_PAGE_PAUSE_MS;
    delete process.env.LUNC_LCD_FALLBACKS;
  });

  it("fetchLuncStakeEarnEvents rejects inverted range and rethrows typed errors", async () => {
    process.env.LUNC_TX_PAGE_PAUSE_MS = "0";
    await expect(
      fetchLuncStakeEarnEvents(ADDR, {
        lcdUrl: "https://lcd.example",
        startMs: 2000,
        endMs: 1000,
        latestBlock: { height: 10, timeMs: 2000 },
      }),
    ).rejects.toThrow(/on or before/);

    await expect(
      fetchLuncStakeEarnEvents(ADDR, {
        lcdUrl: "https://lcd.example",
        fetchImpl: vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ block: { header: { height: "x", time: "bad" } } }),
        }) as unknown as typeof fetch,
        startMs: Date.now() - 1000,
        endMs: Date.now(),
        includePending: false,
        historySource: "lcd",
      }),
    ).rejects.toThrow(/Malformed latest block/);

    await expect(
      fetchLuncStakeEarnEvents(ADDR, {
        lcdUrl: "https://lcd.example",
        fetchImpl: vi.fn().mockRejectedValue(new TypeError("network down")) as unknown as typeof fetch,
        latestBlock: { height: 10, timeMs: Date.now() },
        startMs: Date.now() - 1000,
        endMs: Date.now(),
        includePending: false,
      }),
    ).rejects.toThrow(TypeError);

    // HTTP error on pending after successful empty history
    const fetchImpl = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/cosmos/tx/v1beta1/txs")) {
        return { ok: true, json: async () => ({ tx_responses: [] }) };
      }
      if (u.includes("/rewards")) {
        return { ok: false, status: 429, text: async () => "rate" };
      }
      return { ok: false, status: 404, text: async () => "" };
    });
    await expect(
      fetchLuncStakeEarnEvents(ADDR, {
        lcdUrl: "https://lcd.example",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        latestBlock: { height: 100, timeMs: Date.now() },
        startMs: Date.now() - 60_000,
        endMs: Date.now(),
        nowMs: Date.now(),
        includePending: true,
      }),
    ).rejects.toThrow(/LCD HTTP 429/);

    delete process.env.LUNC_TX_PAGE_PAUSE_MS;
  });

  it("fetchLuncStakeEarnEvents filters out-of-window txs and dedupes pending ids", async () => {
    process.env.LUNC_TX_PAGE_PAUSE_MS = "0";
    const nowMs = Date.parse("2026-07-18T00:00:00Z");
    const inWindow = {
      txhash: "INWIN",
      height: "1",
      code: 0,
      timestamp: "2026-07-10T00:00:00Z",
      events: [
        {
          type: "withdraw_rewards",
          attributes: [
            { key: "amount", value: "1000000uluna" },
            { key: "delegator", value: ADDR },
            { key: "validator", value: "terravaloper1x" },
          ],
        },
      ],
    };
    const outWindow = {
      txhash: "OUTWIN",
      height: "2",
      code: 0,
      timestamp: "2026-01-01T00:00:00Z",
      events: [
        {
          type: "withdraw_rewards",
          attributes: [
            { key: "amount", value: "2000000uluna" },
            { key: "delegator", value: ADDR },
            { key: "validator", value: "terravaloper1y" },
          ],
        },
      ],
    };
    // Pending id that collides with a claimed-style id is unlikely; instead
    // return the same pending twice via normalize — fetchPendingRewards once.
    // Cover seen.has(ev.id) by making history already contain a pending id.
    const pendingId = `lunc_stake:${ADDR}:total:uluna`;
    const fetchImpl = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/cosmos/tx/v1beta1/txs")) {
        if (u.includes("page=1")) {
          return {
            ok: true,
            json: async () => ({ tx_responses: [inWindow, outWindow] }),
          };
        }
        return { ok: true, json: async () => ({ tx_responses: [] }) };
      }
      if (u.includes("/rewards")) {
        return {
          ok: true,
          json: async () => ({
            total: [{ denom: "uluna", amount: "3000000" }],
          }),
        };
      }
      return { ok: false, status: 404, text: async () => "" };
    });

    const events = await fetchLuncStakeEarnEvents(ADDR, {
      lcdUrl: "https://lcd.example",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startMs: Date.parse("2026-07-01T00:00:00Z"),
      endMs: nowMs,
      nowMs,
      latestBlock: { height: 29_550_000, timeMs: nowMs },
      includePending: true,
    });
    expect(events.some((e) => e.meta?.txhash === "OUTWIN")).toBe(false);
    expect(events.some((e) => e.meta?.txhash === "INWIN")).toBe(true);
    expect(events.filter((e) => e.id === pendingId)).toHaveLength(1);
    delete process.env.LUNC_TX_PAGE_PAUSE_MS;
  });

  it("fetchLuncStakeEarnEvents multi-chunk pauses and uses global fetch default", async () => {
    process.env.LUNC_TX_PAGE_PAUSE_MS = "1";
    const nowMs = Date.parse("2026-07-18T00:00:00Z");
    // Span > 90d so luncHistoryChunks yields multiple chunks
    const startMs = nowMs - 120 * 24 * 60 * 60 * 1000;
    const fetchImpl = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/blocks/latest")) {
        return {
          ok: true,
          json: async () => ({
            block: {
              header: {
                height: "30000000",
                time: new Date(nowMs).toISOString(),
              },
            },
          }),
        };
      }
      if (u.includes("/cosmos/tx/v1beta1/txs")) {
        return { ok: true, json: async () => ({ tx_responses: [] }) };
      }
      return { ok: false, status: 404, text: async () => "" };
    });
    vi.stubGlobal("fetch", fetchImpl);
    const events = await fetchLuncStakeEarnEvents(ADDR, {
      lcdUrl: "https://lcd.example",
      startMs,
      endMs: nowMs,
      nowMs,
      includePending: false,
    });
    expect(events).toEqual([]);
    expect(fetchImpl.mock.calls.some((c) => String(c[0]).includes("/blocks/latest"))).toBe(
      true,
    );
    expect(
      fetchImpl.mock.calls.filter((c) => String(c[0]).includes("/cosmos/tx")).length,
    ).toBeGreaterThanOrEqual(2);
    vi.unstubAllGlobals();
    delete process.env.LUNC_TX_PAGE_PAUSE_MS;
  });

  it("text() rejection on failed tx page still surfaces HTTP error", async () => {
    await expect(
      crawlWithdrawRewardTxs(ADDR, {
        lcdUrl: "https://lcd.example",
        heightMin: 1,
        heightMax: 10,
        fetchImpl: vi.fn().mockResolvedValue({
          ok: false,
          status: 502,
          text: async () => {
            throw new Error("no body");
          },
        }) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/LCD HTTP 502/);
  });

  it("crawlWithdrawRewardTxs treats page-out-of-range on page 1 as empty", async () => {
    process.env.LUNC_TX_PAGE_PAUSE_MS = "0";
    const txs = await crawlWithdrawRewardTxs(ADDR, {
      lcdUrl: "https://lcd.example",
      heightMin: 1,
      heightMax: 10,
      fetchImpl: vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "page should be within 1 to 0",
      }) as unknown as typeof fetch,
    });
    expect(txs).toEqual([]);
    delete process.env.LUNC_TX_PAGE_PAUSE_MS;
  });

  it("crawlWithdrawRewardTxs uses global fetch when fetchImpl omitted", async () => {
    process.env.LUNC_TX_PAGE_PAUSE_MS = "0";
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tx_responses: [] }),
    });
    vi.stubGlobal("fetch", fetchImpl);
    const txs = await crawlWithdrawRewardTxs(ADDR, {
      lcdUrl: "https://lcd.example",
      heightMin: 1,
      heightMax: 10,
    });
    expect(txs).toEqual([]);
    expect(fetchImpl).toHaveBeenCalled();
    vi.unstubAllGlobals();
    delete process.env.LUNC_TX_PAGE_PAUSE_MS;
  });

  it("fetchLuncStakeEarnEvents uses DEFAULT_LCD and dedupes fallback list", async () => {
    process.env.LUNC_TX_PAGE_PAUSE_MS = "0";
    process.env.LUNC_LCD_FALLBACKS =
      "https://lcd.example,https://lcd.example/";
    const nowMs = Date.now();
    const fetchImpl = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/blocks/latest")) {
        return {
          ok: true,
          json: async () => ({
            block: {
              header: {
                height: "1000",
                time: new Date(nowMs).toISOString(),
              },
            },
          }),
        };
      }
      if (u.includes("/cosmos/tx/v1beta1/txs")) {
        return { ok: true, json: async () => ({ tx_responses: [] }) };
      }
      return { ok: false, status: 404, text: async () => "" };
    });
    // No lcdUrl → DEFAULT_LCD; fallbacks include duplicates of each other
    const events = await fetchLuncStakeEarnEvents(ADDR, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startMs: nowMs - 60_000,
      endMs: nowMs,
      nowMs,
      includePending: false,
    });
    expect(events).toEqual([]);
    expect(
      fetchImpl.mock.calls.some((c) =>
        String(c[0]).includes("terra-classic-lcd.publicnode.com"),
      ),
    ).toBe(true);
    delete process.env.LUNC_TX_PAGE_PAUSE_MS;
    delete process.env.LUNC_LCD_FALLBACKS;
  });

  it("fetchLuncStakeEarnEvents rejects malformed latest block and dedupes across chunks", async () => {
    process.env.LUNC_TX_PAGE_PAUSE_MS = "0";
    await expect(
      fetchLuncStakeEarnEvents(ADDR, {
        lcdUrl: "https://lcd.example",
        fetchImpl: vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            block: { header: { height: "0", time: "2026-01-01T00:00:00Z" } },
          }),
        }) as unknown as typeof fetch,
        startMs: Date.now() - 1000,
        endMs: Date.now(),
        includePending: false,
        historySource: "lcd",
      }),
    ).rejects.toThrow(/Malformed latest block/);

    // Missing time → Date.parse("") → NaN → malformed
    await expect(
      fetchLuncStakeEarnEvents(ADDR, {
        lcdUrl: "https://lcd.example",
        fetchImpl: vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            block: { header: { height: "100" } },
          }),
        }) as unknown as typeof fetch,
        startMs: Date.now() - 1000,
        endMs: Date.now(),
        includePending: false,
        historySource: "lcd",
      }),
    ).rejects.toThrow(/Malformed latest block/);

    // Same withdraw attrs twice in one tx → identical event ids → seenIds dedupe
    const nowMs = Date.parse("2026-07-18T00:00:00Z");
    const dupAttrs = [
      { key: "amount", value: "1000000uluna" },
      { key: "delegator", value: ADDR },
      { key: "validator", value: "terravaloper1z" },
      { key: "msg_index", value: "0" },
    ];
    const tx = {
      txhash: "DEDUPHASH01",
      height: "29000000",
      code: 0,
      timestamp: "2026-07-10T00:00:00Z",
      events: [
        { type: "withdraw_rewards", attributes: dupAttrs },
        { type: "withdraw_rewards", attributes: dupAttrs },
      ],
    };
    const fetchImpl = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/cosmos/tx/v1beta1/txs")) {
        if (u.includes("page=1")) {
          return { ok: true, json: async () => ({ tx_responses: [tx] }) };
        }
        return { ok: true, json: async () => ({ tx_responses: [] }) };
      }
      return { ok: false, status: 404, text: async () => "" };
    });
    const events = await fetchLuncStakeEarnEvents(ADDR, {
      lcdUrl: "https://lcd.example",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startMs: Date.parse("2026-07-01T00:00:00Z"),
      endMs: nowMs,
      nowMs,
      latestBlock: { height: 29_550_000, timeMs: nowMs },
      includePending: false,
    });
    expect(events.filter((e) => e.meta?.txhash === "DEDUPHASH01")).toHaveLength(
      1,
    );
    delete process.env.LUNC_TX_PAGE_PAUSE_MS;
  });

  it("crawlWithdrawRewardTxs treats missing tx_responses as empty page", async () => {
    process.env.LUNC_TX_PAGE_PAUSE_MS = "0";
    const txs = await crawlWithdrawRewardTxs(ADDR, {
      lcdUrl: "https://lcd.example",
      heightMin: 1,
      heightMax: 10,
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}), // no tx_responses → ?? []
      }) as unknown as typeof fetch,
    });
    expect(txs).toEqual([]);
    delete process.env.LUNC_TX_PAGE_PAUSE_MS;
  });

  it("crawlWithdrawRewardTxs every() sees missing timestamps when checking early-stop", async () => {
    process.env.LUNC_TX_PAGE_PAUSE_MS = "0";
    const startMs = Date.parse("2026-06-01T00:00:00Z");
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tx_responses: [
            {
              txhash: "OLD",
              timestamp: "2026-05-01T00:00:00Z",
              code: 0,
              events: [],
            },
            {
              txhash: "NOTIME",
              code: 0,
              events: [],
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tx_responses: [] }),
      });
    const txs = await crawlWithdrawRewardTxs(ADDR, {
      lcdUrl: "https://lcd.example",
      heightMin: 1,
      heightMax: 10,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startMs,
    });
    expect(txs.map((t) => t.txhash).sort()).toEqual(["NOTIME", "OLD"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    delete process.env.LUNC_TX_PAGE_PAUSE_MS;
  });

  it("fetchLuncStakeEarnEvents pauses with default PAGE_PAUSE_MS between pages", async () => {
    delete process.env.LUNC_TX_PAGE_PAUSE_MS; // hit ?? 250 default

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tx_responses: [
            {
              txhash: "P1",
              timestamp: "2026-07-01T00:00:00Z",
              code: 0,
              events: [],
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tx_responses: [] }),
      });

    // Spy setTimeout to avoid waiting 250ms
    const setTimeoutSpy = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation(((fn: () => void) => {
        fn();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as unknown as typeof setTimeout);

    await crawlWithdrawRewardTxs(ADDR, {
      lcdUrl: "https://lcd.example",
      heightMin: 1,
      heightMax: 10,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(setTimeoutSpy).toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
    process.env.LUNC_TX_PAGE_PAUSE_MS = "0";
  });

  it("fcdTxToLcdShape flattens logs and parseLowestHeightMessage works", () => {
    const shaped = fcdTxToLcdShape({
      txhash: "ABC",
      timestamp: "2026-01-01T00:00:00Z",
      logs: [
        {
          events: [
            {
              type: "withdraw_rewards",
              attributes: [{ key: "amount", value: "1uluna" }],
            },
          ],
        },
      ],
    });
    expect(shaped.events).toHaveLength(1);
    expect(shaped.events?.[0]?.type).toBe("withdraw_rewards");
    expect(() => fcdTxToLcdShape(null as never)).toThrow(LuncAdapterError);
    expect(parseLowestHeightMessage('lowest height is 28062898')).toBe(
      28062898,
    );
    expect(parseLowestHeightMessage("nope")).toBeNull();
    expect(fcdCandidates("https://fcd.a").length).toBeGreaterThanOrEqual(1);
  });

  it("crawlFcdAccountTxs paginates offset and normalizes autostake withdraws", async () => {
    process.env.LUNC_TX_PAGE_PAUSE_MS = "0";
    const page1 = load("fcd-txs-sample.json");
    const page2 = {
      next: null,
      limit: 100,
      txs: [
        {
          txhash: "FCDHASHOLDABCDEF0123456789ABCDEF0123456789ABCDEF0123456789AB",
          height: "20000000",
          code: 0,
          timestamp: "2024-06-01T00:00:00Z",
          logs: [
            {
              events: [
                {
                  type: "withdraw_rewards",
                  attributes: [
                    { key: "amount", value: "1000000uluna" },
                    {
                      key: "validator",
                      value: "terravaloper1autostake",
                    },
                    { key: "delegator", value: ADDR },
                    { key: "msg_index", value: "0" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const fetchImpl = vi.fn(async (url: string) => {
      const u = String(url);
      expect(u).toContain("/v1/txs");
      expect(u).toContain(`account=${ADDR}`);
      if (u.includes("offset=")) {
        return { ok: true, json: async () => page2 };
      }
      return { ok: true, json: async () => page1 };
    });

    const txs = await crawlFcdAccountTxs(ADDR, {
      fcdUrl: "https://fcd.example",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startMs: Date.parse("2024-01-01T00:00:00Z"),
      endMs: Date.parse("2026-07-01T00:00:00Z"),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const events = normalizeWithdrawRewardTxs(ADDR, txs);
    // page1 has 2 withdraw txs (3 denoms) + page2 has 1 — send-only ignored
    expect(events.length).toBe(4);
    expect(events.every((e) => e.meta?.kind === "claimed")).toBe(true);
    expect(events.some((e) => e.amount === "5")).toBe(true);
    expect(events.some((e) => e.earnedAt.startsWith("2024-06"))).toBe(true);
    delete process.env.LUNC_TX_PAGE_PAUSE_MS;
  });

  it("crawlFcdAccountTxs early-stops when page is older than startMs", async () => {
    process.env.LUNC_TX_PAGE_PAUSE_MS = "0";
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        next: 99,
        txs: [
          {
            txhash: "OLD1",
            timestamp: "2023-01-01T00:00:00Z",
            logs: [],
          },
          {
            txhash: "OLD2",
            timestamp: "2023-01-02T00:00:00Z",
            logs: [],
          },
        ],
      }),
    }));
    const txs = await crawlFcdAccountTxs(ADDR, {
      fcdUrl: "https://fcd.example",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startMs: Date.parse("2025-01-01T00:00:00Z"),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(txs).toHaveLength(2);
    delete process.env.LUNC_TX_PAGE_PAUSE_MS;
  });

  it("fetchLuncStakeEarnEvents prefers FCD history over LCD", async () => {
    process.env.LUNC_TX_PAGE_PAUSE_MS = "0";
    process.env.LUNC_FCD_FALLBACKS = "";
    const fcd = load("fcd-txs-sample.json");
    const rewards = load("rewards-sample.json");
    const nowMs = Date.parse("2026-07-18T00:00:00Z");
    const fetchImpl = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/v1/txs")) {
        return {
          ok: true,
          json: async () => ({ ...fcd, next: null }),
        };
      }
      if (u.includes("/rewards")) {
        return { ok: true, json: async () => rewards };
      }
      // LCD history must not be required when FCD works
      if (u.includes("/cosmos/tx/v1beta1/txs")) {
        throw new Error("LCD history should not be called");
      }
      return { ok: false, status: 404, text: async () => "" };
    });

    const events = await fetchLuncStakeEarnEvents(ADDR, {
      fcdUrl: "https://fcd.example",
      lcdUrl: "https://lcd.example",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startMs: Date.parse("2024-01-01T00:00:00Z"),
      endMs: nowMs,
      nowMs,
      includePending: true,
    });
    const claimed = events.filter((e) => e.rawType === "withdraw_delegator_reward");
    const pending = events.filter((e) => e.rawType === "pending_total_reward");
    expect(claimed.length).toBe(3);
    expect(pending.length).toBe(2);
    expect(
      claimed.some((e) => e.meta?.txhash?.startsWith("FCDHASH0001")),
    ).toBe(true);
    delete process.env.LUNC_TX_PAGE_PAUSE_MS;
    delete process.env.LUNC_FCD_FALLBACKS;
  });

  it("fetchLuncStakeEarnEvents falls back to LCD when FCD is down", async () => {
    process.env.LUNC_TX_PAGE_PAUSE_MS = "0";
    process.env.LUNC_FCD_FALLBACKS = "";
    process.env.LUNC_LCD_FALLBACKS = "";
    const withdraw = load("withdraw-txs-sample.json");
    const nowMs = Date.parse("2026-07-18T00:00:00Z");
    const fetchImpl = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/v1/txs")) {
        return { ok: false, status: 503, text: async () => "unavailable" };
      }
      if (u.includes("/blocks/latest")) {
        return {
          ok: true,
          json: async () => ({
            block: {
              header: {
                height: "29550000",
                time: new Date(nowMs).toISOString(),
              },
            },
          }),
        };
      }
      if (u.includes("/blocks/1")) {
        return {
          ok: false,
          status: 500,
          text: async () =>
            JSON.stringify({ message: "height 1 is not available, lowest height is 28000000" }),
        };
      }
      if (u.includes("/cosmos/tx/v1beta1/txs")) {
        if (u.includes("page=1")) {
          return { ok: true, json: async () => withdraw };
        }
        return { ok: true, json: async () => ({ tx_responses: [] }) };
      }
      return { ok: false, status: 404, text: async () => "" };
    });

    const events = await fetchLuncStakeEarnEvents(ADDR, {
      fcdUrl: "https://fcd.example",
      lcdUrl: "https://lcd.example",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startMs: Date.parse("2026-06-01T00:00:00Z"),
      endMs: nowMs,
      nowMs,
      includePending: false,
      latestBlock: { height: 29_550_000, timeMs: nowMs },
    });
    expect(events.some((e) => e.rawType === "withdraw_delegator_reward")).toBe(
      true,
    );
    delete process.env.LUNC_TX_PAGE_PAUSE_MS;
    delete process.env.LUNC_FCD_FALLBACKS;
    delete process.env.LUNC_LCD_FALLBACKS;
  });

  it("crawlFcdAccountTxs fails closed on HTTP and malformed payloads", async () => {
    await expect(
      crawlFcdAccountTxs(ADDR, {
        fcdUrl: "https://fcd.example",
        fetchImpl: vi.fn().mockResolvedValue({
          ok: false,
          status: 502,
          text: async () => "",
        }) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/FCD HTTP 502/);

    await expect(
      crawlFcdAccountTxs(ADDR, {
        fcdUrl: "https://fcd.example",
        fetchImpl: vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ txs: null }),
        }) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/Malformed FCD/);
  });

  it("fcdTxToLcdShape tolerates null logs and missing log.events", () => {
    expect(
      fcdTxToLcdShape({
        txhash: "NULOGS",
        timestamp: "2026-01-01T00:00:00Z",
        logs: null,
      }).events,
    ).toEqual([]);
    expect(
      fcdTxToLcdShape({
        txhash: "NOEV",
        timestamp: "2026-01-01T00:00:00Z",
        logs: [{}],
      }).events,
    ).toEqual([]);
  });

  it("lcdCandidates and fcdCandidates skip empty URLs", () => {
    process.env.LUNC_LCD_FALLBACKS = "";
    process.env.LUNC_FCD_FALLBACKS = "";
    expect(lcdCandidates("")).toEqual([]);
    expect(fcdCandidates("")).toEqual([]);
    expect(lcdCandidates("https://lcd.a/")).toEqual(["https://lcd.a"]);
    delete process.env.LUNC_LCD_FALLBACKS;
    delete process.env.LUNC_FCD_FALLBACKS;
  });

  it("parseLowestHeightMessage rejects non-positive heights", () => {
    expect(parseLowestHeightMessage("lowest height is 0")).toBeNull();
    expect(parseLowestHeightMessage("lowest height is NaN")).toBeNull();
  });

  it("crawlFcdAccountTxs covers empty/dupe/missing-hash pages and global fetch", async () => {
    process.env.LUNC_TX_PAGE_PAUSE_MS = "0";
    const empty = await crawlFcdAccountTxs(ADDR, {
      fcdUrl: "https://fcd.example",
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ txs: [], next: null }),
      }) as unknown as typeof fetch,
    });
    expect(empty).toEqual([]);

    const tx = {
      txhash: "SAMEFCD",
      timestamp: "2026-07-01T00:00:00Z",
      logs: [],
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          next: 2,
          txs: [
            tx,
            { timestamp: "2026-07-01T00:00:00Z", logs: [] }, // no hash
            { ...tx }, // dupe
            { txhash: "NOTIMEFCD", logs: [] }, // no timestamp
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ next: null, txs: [tx] }), // all dupes → newCount 0
      });
    const txs = await crawlFcdAccountTxs(ADDR, {
      fcdUrl: "https://fcd.example/",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(txs.map((t) => t.txhash).sort()).toEqual(["NOTIMEFCD", "SAMEFCD"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    // early-stop every() with missing timestamps
    const early = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        next: 9,
        txs: [
          { txhash: "OLD", timestamp: "2020-01-01T00:00:00Z", logs: [] },
          { txhash: "GAP", logs: [] },
        ],
      }),
    });
    await crawlFcdAccountTxs(ADDR, {
      fcdUrl: "https://fcd.example",
      fetchImpl: early as unknown as typeof fetch,
      startMs: Date.parse("2025-01-01T00:00:00Z"),
    });
    // Missing timestamp prevents early-stop; page 2 yields only dupes → stop.
    expect(early).toHaveBeenCalledTimes(2);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ txs: [], next: null }),
      }),
    );
    expect(
      await crawlFcdAccountTxs(ADDR, { fcdUrl: "https://fcd.example" }),
    ).toEqual([]);
    vi.unstubAllGlobals();
    delete process.env.LUNC_TX_PAGE_PAUSE_MS;
  });

  it("fetchLuncStakeEarnEvents covers FCD soft/hard errors and empty candidates", async () => {
    process.env.LUNC_TX_PAGE_PAUSE_MS = "0";
    process.env.LUNC_FCD_FALLBACKS = "";
    process.env.LUNC_LCD_FALLBACKS = "";

    await expect(
      fetchLuncStakeEarnEvents(ADDR, {
        fcdUrl: "",
        historySource: "fcd",
        includePending: false,
        startMs: Date.now() - 1000,
        endMs: Date.now(),
      }),
    ).rejects.toThrow(/No Terra Classic FCD/);

    await expect(
      fetchLuncStakeEarnEvents(ADDR, {
        fcdUrl: "https://fcd.example",
        historySource: "fcd",
        includePending: false,
        startMs: Date.now() - 1000,
        endMs: Date.now(),
        fetchImpl: vi.fn().mockResolvedValue({
          ok: false,
          status: 503,
          text: async () => "down",
        }) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/FCD HTTP 503/);

    await expect(
      fetchLuncStakeEarnEvents(ADDR, {
        fcdUrl: "https://fcd.example",
        historySource: "fcd",
        includePending: false,
        startMs: Date.now() - 1000,
        endMs: Date.now(),
        fetchImpl: vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ txs: "nope" }),
        }) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/Malformed FCD/);

    await expect(
      fetchLuncStakeEarnEvents(ADDR, {
        lcdUrl: "",
        historySource: "lcd",
        includePending: false,
        startMs: Date.now() - 1000,
        endMs: Date.now(),
        fetchImpl: vi.fn() as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/No Terra Classic LCD/);

    delete process.env.LUNC_TX_PAGE_PAUSE_MS;
    delete process.env.LUNC_FCD_FALLBACKS;
    delete process.env.LUNC_LCD_FALLBACKS;
  });

  it("fetchLuncStakeEarnEvents filters FCD window, dedupes, prune clamp, soft LCD errors", async () => {
    process.env.LUNC_TX_PAGE_PAUSE_MS = "0";
    process.env.LUNC_FCD_FALLBACKS = "";
    process.env.LUNC_LCD_FALLBACKS = "https://lcd-fallback.example";
    const nowMs = Date.parse("2026-07-18T00:00:00Z");
    const startMs = Date.parse("2026-07-01T00:00:00Z");
    const withdrawAttrs = [
      { key: "amount", value: "1000000uluna" },
      { key: "delegator", value: ADDR },
      { key: "validator", value: "terravaloper1z" },
      { key: "msg_index", value: "0" },
    ];
    const inWin = {
      txhash: "FCDIN",
      timestamp: "2026-07-10T00:00:00Z",
      logs: [{ events: [{ type: "withdraw_rewards", attributes: withdrawAttrs }] }],
    };
    const outWin = {
      txhash: "FCDOUT",
      timestamp: "2025-01-01T00:00:00Z",
      logs: [{ events: [{ type: "withdraw_rewards", attributes: withdrawAttrs }] }],
    };
    const dupIn = {
      ...inWin,
      txhash: "FCDDUP",
      logs: [
        {
          events: [
            { type: "withdraw_rewards", attributes: withdrawAttrs },
            { type: "withdraw_rewards", attributes: withdrawAttrs },
          ],
        },
      ],
    };

    const fetchImpl = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/v1/txs")) {
        return {
          ok: true,
          json: async () => ({ next: null, txs: [inWin, outWin, dupIn] }),
        };
      }
      if (u.includes("/rewards")) {
        return {
          ok: true,
          json: async () => ({
            total: [{ denom: "uluna", amount: "1000000" }],
          }),
        };
      }
      return { ok: false, status: 404, text: async () => "" };
    });

    const events = await fetchLuncStakeEarnEvents(ADDR, {
      fcdUrl: "https://fcd.example",
      lcdUrl: "https://lcd.example",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startMs,
      endMs: nowMs,
      nowMs,
      includePending: true,
    });
    expect(events.some((e) => e.meta?.txhash === "FCDOUT")).toBe(false);
    expect(events.filter((e) => e.meta?.txhash === "FCDIN")).toHaveLength(1);
    expect(events.filter((e) => e.meta?.txhash === "FCDDUP")).toHaveLength(1);

    // LCD path: prune height above estimated max → heightMin > heightMax skip;
    // primary throws non-adapter then typed soft error; fallback ok + blocks/1 ok;
    // text() rejection on prune probe.
    let primaryHits = 0;
    const lcdFetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("lcd.primary") && u.includes("/blocks/latest")) {
        primaryHits += 1;
        if (primaryHits === 1) throw new TypeError("socket reset");
        return { ok: false, status: 502, text: async () => "bad gateway" };
      }
      if (u.includes("/blocks/latest")) {
        return {
          ok: true,
          json: async () => ({
            block: {
              header: {
                height: "1000",
                time: new Date(nowMs).toISOString(),
              },
            },
          }),
        };
      }
      if (u.includes("/blocks/1")) {
        if (u.includes("lcd-fallback")) {
          return { ok: true, json: async () => ({ block: {} }) }; // prune = 1
        }
        return {
          ok: false,
          status: 500,
          text: async () => {
            throw new Error("no body");
          },
        };
      }
      if (u.includes("/cosmos/tx/v1beta1/txs")) {
        return { ok: true, json: async () => ({ tx_responses: [] }) };
      }
      return { ok: false, status: 404, text: async () => "" };
    });

    // First: TypeError from primary must propagate (non-LuncAdapterError)
    await expect(
      fetchLuncStakeEarnEvents(ADDR, {
        fcdUrl: "https://fcd.down",
        lcdUrl: "https://lcd.primary.example",
        fetchImpl: lcdFetch as unknown as typeof fetch,
        historySource: "lcd",
        startMs: nowMs - 60_000,
        endMs: nowMs,
        nowMs,
        includePending: false,
      }),
    ).rejects.toThrow(TypeError);

    // Soft 502 on primary → fallback; prune ok path; extreme prune clamp
    const clampFetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/v1/txs")) {
        return { ok: false, status: 503, text: async () => "" };
      }
      if (u.includes("/blocks/latest")) {
        return {
          ok: true,
          json: async () => ({
            block: {
              header: {
                height: "10000",
                time: new Date(nowMs).toISOString(),
              },
            },
          }),
        };
      }
      if (u.includes("/blocks/1")) {
        return {
          ok: false,
          status: 500,
          text: async () => "lowest height is 999999999",
        };
      }
      if (u.includes("/cosmos/tx/v1beta1/txs")) {
        return { ok: true, json: async () => ({ tx_responses: [] }) };
      }
      return { ok: false, status: 404, text: async () => "" };
    });
    const clamped = await fetchLuncStakeEarnEvents(ADDR, {
      fcdUrl: "https://fcd.down",
      lcdUrl: "https://lcd.example",
      fetchImpl: clampFetch as unknown as typeof fetch,
      historySource: "auto",
      startMs: nowMs - 60_000,
      endMs: nowMs,
      nowMs,
      includePending: false,
      latestBlock: { height: 10_000, timeMs: nowMs },
    });
    expect(clamped).toEqual([]);

    // Soft HTTP on primary LCD → try fallback; /blocks/1 ok → prune=1; text() catch
    process.env.LUNC_LCD_FALLBACKS = "https://lcd-fallback.example";
    let pruneTextRejects = false;
    const softLcd = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/v1/txs")) {
        return { ok: false, status: 503, text: async () => "" };
      }
      if (u.includes("lcd.primary") && u.includes("/blocks/latest")) {
        return { ok: false, status: 502, text: async () => "bad gateway" };
      }
      if (u.includes("/blocks/latest")) {
        return {
          ok: true,
          json: async () => ({
            block: {
              header: {
                height: "29550000",
                time: new Date(nowMs).toISOString(),
              },
            },
          }),
        };
      }
      if (u.includes("/blocks/1")) {
        if (!pruneTextRejects) {
          pruneTextRejects = true;
          return {
            ok: false,
            status: 500,
            text: async () => {
              throw new Error("no body");
            },
          };
        }
        return { ok: true, json: async () => ({ block: {} }) };
      }
      if (u.includes("/cosmos/tx/v1beta1/txs")) {
        return { ok: true, json: async () => ({ tx_responses: [] }) };
      }
      return { ok: false, status: 404, text: async () => "" };
    });
    const softOk = await fetchLuncStakeEarnEvents(ADDR, {
      fcdUrl: "https://fcd.down",
      lcdUrl: "https://lcd.primary.example",
      fetchImpl: softLcd as unknown as typeof fetch,
      historySource: "lcd",
      startMs: nowMs - 60_000,
      endMs: nowMs,
      nowMs,
      includePending: false,
    });
    expect(softOk).toEqual([]);
    expect(
      softLcd.mock.calls.some((c) => String(c[0]).includes("lcd-fallback")),
    ).toBe(true);

    delete process.env.LUNC_TX_PAGE_PAUSE_MS;
    delete process.env.LUNC_FCD_FALLBACKS;
    delete process.env.LUNC_LCD_FALLBACKS;
  });

  it("fetchLuncStakeEarnEvents pending soft-fallback and typed rethrows", async () => {
    process.env.LUNC_TX_PAGE_PAUSE_MS = "0";
    process.env.LUNC_FCD_FALLBACKS = "";
    process.env.LUNC_LCD_FALLBACKS = "https://lcd-b.example";
    const nowMs = Date.parse("2026-07-18T00:00:00Z");

    // FCD history ok; pending primary soft-fails then fallback; empty lcd list → pending ?? []
    const fcdOk = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/v1/txs")) {
        return { ok: true, json: async () => ({ next: null, txs: [] }) };
      }
      if (u.includes("lcd-a") && u.includes("/rewards")) {
        return { ok: false, status: 502, text: async () => "soft" };
      }
      if (u.includes("/rewards")) {
        return {
          ok: true,
          json: async () => ({
            total: [{ denom: "uluna", amount: "1000000" }],
          }),
        };
      }
      return { ok: false, status: 404, text: async () => "" };
    });
    const withPending = await fetchLuncStakeEarnEvents(ADDR, {
      fcdUrl: "https://fcd.example",
      lcdUrl: "https://lcd-a.example",
      fetchImpl: fcdOk as unknown as typeof fetch,
      startMs: nowMs - 60_000,
      endMs: nowMs,
      nowMs,
      includePending: true,
    });
    expect(withPending.some((e) => e.rawType === "pending_total_reward")).toBe(
      true,
    );

    // pending TypeError propagates
    await expect(
      fetchLuncStakeEarnEvents(ADDR, {
        fcdUrl: "https://fcd.example",
        lcdUrl: "https://lcd.example",
        fetchImpl: vi.fn(async (url: string) => {
          const u = String(url);
          if (u.includes("/v1/txs")) {
            return { ok: true, json: async () => ({ next: null, txs: [] }) };
          }
          if (u.includes("/rewards")) throw new TypeError("rewards boom");
          return { ok: false, status: 404, text: async () => "" };
        }) as unknown as typeof fetch,
        startMs: nowMs - 60_000,
        endMs: nowMs,
        nowMs,
        includePending: true,
      }),
    ).rejects.toThrow(TypeError);

    // pending malformed rewards rethrow
    await expect(
      fetchLuncStakeEarnEvents(ADDR, {
        fcdUrl: "https://fcd.example",
        lcdUrl: "https://lcd.example",
        fetchImpl: vi.fn(async (url: string) => {
          const u = String(url);
          if (u.includes("/v1/txs")) {
            return { ok: true, json: async () => ({ next: null, txs: [] }) };
          }
          if (u.includes("/rewards")) {
            return {
              ok: true,
              json: async () => ({
                total: [{ denom: "", amount: "1" }],
              }),
            };
          }
          return { ok: false, status: 404, text: async () => "" };
        }) as unknown as typeof fetch,
        startMs: nowMs - 60_000,
        endMs: nowMs,
        nowMs,
        includePending: true,
      }),
    ).rejects.toThrow(LuncAdapterError);

    // No LCD candidates for pending → empty pending merge (?? [])
    process.env.LUNC_LCD_FALLBACKS = "";
    const noLcdPending = await fetchLuncStakeEarnEvents(ADDR, {
      fcdUrl: "https://fcd.example",
      lcdUrl: "",
      fetchImpl: vi.fn(async (url: string) => {
        if (String(url).includes("/v1/txs")) {
          return { ok: true, json: async () => ({ next: null, txs: [] }) };
        }
        return { ok: false, status: 404, text: async () => "" };
      }) as unknown as typeof fetch,
      startMs: nowMs - 60_000,
      endMs: nowMs,
      nowMs,
      includePending: true,
    });
    expect(noLcdPending).toEqual([]);

    delete process.env.LUNC_TX_PAGE_PAUSE_MS;
    delete process.env.LUNC_FCD_FALLBACKS;
    delete process.env.LUNC_LCD_FALLBACKS;
  });

  it("detectLcdPruneHeight returns 1 when genesis block is available", async () => {
    process.env.LUNC_TX_PAGE_PAUSE_MS = "0";
    process.env.LUNC_FCD_FALLBACKS = "";
    process.env.LUNC_LCD_FALLBACKS = "";
    const nowMs = Date.now();
    const fetchImpl = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/v1/txs")) {
        return { ok: false, status: 503, text: async () => "" };
      }
      if (u.includes("/blocks/1")) {
        return { ok: true, json: async () => ({ block: { header: { height: "1" } } }) };
      }
      if (u.includes("/cosmos/tx/v1beta1/txs")) {
        return { ok: true, json: async () => ({ tx_responses: [] }) };
      }
      return { ok: false, status: 404, text: async () => "" };
    });
    const events = await fetchLuncStakeEarnEvents(ADDR, {
      fcdUrl: "https://fcd.down",
      lcdUrl: "https://lcd.example",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      historySource: "lcd",
      startMs: nowMs - 60_000,
      endMs: nowMs,
      nowMs,
      includePending: false,
      latestBlock: { height: 1000, timeMs: nowMs },
    });
    expect(events).toEqual([]);
    expect(
      fetchImpl.mock.calls.some((c) => String(c[0]).includes("/blocks/1")),
    ).toBe(true);
    delete process.env.LUNC_TX_PAGE_PAUSE_MS;
    delete process.env.LUNC_FCD_FALLBACKS;
    delete process.env.LUNC_LCD_FALLBACKS;
  });

  it("detectLcdPruneHeight swallows probe failures via soft LCD crawl", async () => {
    process.env.LUNC_TX_PAGE_PAUSE_MS = "0";
    process.env.LUNC_FCD_FALLBACKS = "";
    process.env.LUNC_LCD_FALLBACKS = "";
    const nowMs = Date.now();
    const fetchImpl = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/v1/txs")) {
        return { ok: false, status: 503, text: async () => "" };
      }
      if (u.includes("/blocks/1")) {
        throw new Error("network");
      }
      if (u.includes("/cosmos/tx/v1beta1/txs")) {
        return { ok: true, json: async () => ({ tx_responses: [] }) };
      }
      return { ok: false, status: 404, text: async () => "" };
    });
    const events = await fetchLuncStakeEarnEvents(ADDR, {
      fcdUrl: "https://fcd.down",
      lcdUrl: "https://lcd.example",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      historySource: "lcd",
      startMs: nowMs - 60_000,
      endMs: nowMs,
      nowMs,
      includePending: false,
      latestBlock: { height: 1000, timeMs: nowMs },
    });
    expect(events).toEqual([]);
    delete process.env.LUNC_TX_PAGE_PAUSE_MS;
    delete process.env.LUNC_FCD_FALLBACKS;
    delete process.env.LUNC_LCD_FALLBACKS;
  });
});
