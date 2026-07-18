import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  LuncAdapterError,
  denomToAsset,
  fetchLuncStakeEarnEvents,
  microToHuman,
  normalizeLuncRewards,
  parseLuncAddress,
} from "../../web/src/lib/adapters/lunc-stake";

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

  it("normalizes pending rewards from fixture", () => {
    const events = normalizeLuncRewards(ADDR, load("rewards-sample.json"), new Date("2024-07-01T00:00:00Z"));
    expect(events.length).toBe(3);
    expect(events.every((e) => e.source === "lunc_stake")).toBe(true);
    expect(events[0].asset).toBe("LUNC");
    expect(events.some((e) => e.asset === "USTC")).toBe(true);
    expect(events.every((e) => e.id.startsWith("lunc_stake:"))).toBe(true);
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

  it("fetchLuncStakeEarnEvents uses LCD", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => load("rewards-sample.json"),
    });
    const events = await fetchLuncStakeEarnEvents(ADDR, {
      lcdUrl: "https://lcd.example",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(events.length).toBe(3);
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://lcd.example/cosmos/distribution/v1beta1/delegators/${ADDR}/rewards`,
      expect.any(Object),
    );
  });

  it("fetch fails closed on HTTP error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    await expect(
      fetchLuncStakeEarnEvents(ADDR, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/LCD HTTP 500/);
  });

  it("emits total rewards when per-validator empty", () => {
    const events = normalizeLuncRewards(ADDR, {
      rewards: [],
      total: [{ denom: "uluna", "amount": "2000000" }],
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
});
