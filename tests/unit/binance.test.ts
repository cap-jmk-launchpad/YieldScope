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
    vi.useRealTimers();
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
    expect(url).toContain("startTime=");
    expect(url).toContain("endTime=");
    expect(url).toContain("type=ALL");
  });

  it("retries on HTTP 429 then succeeds", async () => {
    vi.useFakeTimers();
    const payload = load("rewards-empty.json");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => "rate",
      })
      .mockResolvedValue({
        ok: true,
        json: async () => payload,
      });
    vi.stubGlobal("fetch", fetchMock);
    const pending = fetchBinanceEarnEvents({ apiKey: "k", apiSecret: "s" });
    await vi.runAllTimersAsync();
    await pending;
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    vi.useRealTimers();
  });

  it("fetchBinanceEarnEvents passes custom date range", async () => {
    const payload = load("rewards-empty.json");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => payload,
      }),
    );
    const startMs = Date.parse("2024-07-01T00:00:00.000Z");
    const endMs = Date.parse("2024-07-10T23:59:59.999Z");
    await fetchBinanceEarnEvents(
      { apiKey: "k", apiSecret: "s" },
      { startMs, endMs },
    );
    const url = String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url).toContain(`startTime=${startMs}`);
    expect(url).toContain(`endTime=${endMs}`);
  });

  it("fetchBinanceEarnEvents allTime walks the full lookback (no early stop)", async () => {
    const empty = load("rewards-empty.json");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => empty,
    });
    vi.stubGlobal("fetch", fetchMock);
    await fetchBinanceEarnEvents(
      { apiKey: "k", apiSecret: "s" },
      { allTime: true },
    );
    // 5y lookback / ≤30d chunks ≈ 61 windows — must not stop after 3 empties
    expect(fetchMock.mock.calls.length).toBeGreaterThan(50);
  });

  it("fetchBinanceEarnEvents walks every chunk for a multi-year custom range", async () => {
    const empty = load("rewards-empty.json");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => empty,
    });
    vi.stubGlobal("fetch", fetchMock);
    const startMs = Date.parse("2019-07-01T00:00:00.000Z");
    const endMs = Date.parse("2024-07-01T23:59:59.999Z");
    await fetchBinanceEarnEvents(
      { apiKey: "k", apiSecret: "s" },
      { startMs, endMs },
    );
    // ~5 years → more than 50 × 30-day windows
    expect(fetchMock.mock.calls.length).toBeGreaterThan(50);
    const firstUrl = String(fetchMock.mock.calls[0][0]);
    const lastUrl = String(
      fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0],
    );
    expect(firstUrl).toContain(`endTime=${endMs}`);
    expect(lastUrl).toContain(`startTime=${startMs}`);
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

  it("paginates until page cap when total stays ahead", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        const rows = Array.from({ length: 100 }, (_, i) => ({
          asset: "USDT",
          rewards: String(i),
          time: 1_719_792_000_000 + calls * 10_000 + i,
          projectId: `p${calls}-${i}`,
        }));
        return {
          ok: true,
          json: async () => ({ rows, total: 9_999 }),
        };
      }),
    );
    const events = await fetchBinanceEarnEvents(
      { apiKey: "k", apiSecret: "s" },
      {
        startMs: Date.parse("2024-07-01T00:00:00.000Z"),
        endMs: Date.parse("2024-07-05T00:00:00.000Z"),
      },
    );
    expect(calls).toBe(50);
    expect(events.length).toBe(5000);
  });
});
