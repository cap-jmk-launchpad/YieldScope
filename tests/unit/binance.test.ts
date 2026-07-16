import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BinanceAdapterError,
  fetchBinanceEarnEvents,
  normalizeBinanceRewards,
} from "../../web/src/lib/adapters/binance";

const root = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/binance");

function load(name: string) {
  return JSON.parse(readFileSync(join(root, name), "utf8"));
}

describe("Binance Simple Earn adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes reward rows from fixture", () => {
    const events = normalizeBinanceRewards(load("rewards-page1.json"));
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      source: "binance",
      asset: "USDT",
      amount: "1.23456789",
    });
    expect(events[0].earnedAt).toBe("2024-07-01T00:00:00.000Z");
    expect(events[1].asset).toBe("BTC");
    expect(events.every((e) => e.id.startsWith("binance:"))).toBe(true);
  });

  it("returns empty array for empty account", () => {
    expect(normalizeBinanceRewards(load("rewards-empty.json"))).toEqual([]);
  });

  it("fails closed on malformed row", () => {
    expect(() =>
      normalizeBinanceRewards({
        rows: [
          {
            asset: "USDT",
            rewards: "1",
            time: undefined as unknown as number,
          },
        ],
      }),
    ).toThrow(BinanceAdapterError);
  });

  it("fetchBinanceEarnEvents with API key signs request", async () => {
    const payload = load("rewards-page1.json");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => payload,
      }),
    );
    const events = await fetchBinanceEarnEvents({
      apiKey: "k",
      apiSecret: "s",
    });
    expect(events.length).toBe(2);
    expect(fetch).toHaveBeenCalled();
    const url = String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url).toContain("signature=");
  });

  it("fetchBinanceEarnEvents with accessToken uses Bearer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => load("rewards-empty.json"),
      }),
    );
    const events = await fetchBinanceEarnEvents({
      apiKey: "",
      apiSecret: "",
      accessToken: "tok",
    });
    expect(events).toEqual([]);
    const init = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(init.headers.Authorization).toBe("Bearer tok");
  });

  it("fetchBinanceEarnEvents oauth HTTP error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401 }),
    );
    await expect(
      fetchBinanceEarnEvents({
        apiKey: "",
        apiSecret: "",
        accessToken: "tok",
      }),
    ).rejects.toThrow(/OAuth HTTP 401/);
  });

  it("fetch fails closed on HTTP error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => "forbidden",
      }),
    );
    await expect(
      fetchBinanceEarnEvents({ apiKey: "k", apiSecret: "s" }),
    ).rejects.toThrow(/HTTP 403/);
  });

  it("fetch fails closed when credentials missing", async () => {
    await expect(
      fetchBinanceEarnEvents({ apiKey: "", apiSecret: "" }),
    ).rejects.toThrow(/Missing Binance/);
  });
});
