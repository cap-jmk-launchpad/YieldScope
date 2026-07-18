import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OkxAdapterError,
  fetchOkxEarnEvents,
  formatOkxApiError,
  normalizeOkxEarn,
  resetOkxBaseCache,
  resolveOkxApiBases,
  signOkxRequest,
} from "../../web/src/lib/adapters/okx";

const root = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/okx");

function load(name: string) {
  return JSON.parse(readFileSync(join(root, name), "utf8"));
}

describe("OKX earn adapter", () => {
  const prevBase = process.env.OKX_API_BASE;
  const prevSim = process.env.OKX_SIMULATED_TRADING;

  beforeEach(() => {
    resetOkxBaseCache();
    delete process.env.OKX_API_BASE;
    delete process.env.OKX_SIMULATED_TRADING;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetOkxBaseCache();
    if (prevBase === undefined) delete process.env.OKX_API_BASE;
    else process.env.OKX_API_BASE = prevBase;
    if (prevSim === undefined) delete process.env.OKX_SIMULATED_TRADING;
    else process.env.OKX_SIMULATED_TRADING = prevSim;
  });

  it("normalizes lending history fixture", () => {
    const events = normalizeOkxEarn(load("lending-history.json"));
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      source: "okx",
      asset: "USDT",
      amount: "0.55",
    });
    expect(events[1].asset).toBe("ETH");
  });

  it("handles empty data", () => {
    expect(normalizeOkxEarn(load("lending-empty.json"))).toEqual([]);
  });

  it("maps auth errors without inventing rows", () => {
    expect(() => normalizeOkxEarn(load("error-auth.json"))).toThrow(
      OkxAdapterError,
    );
  });

  it("surfaces 50119 with region hint", () => {
    expect(formatOkxApiError("50119", "API key doesn't exist")).toMatch(
      /eea\.okx\.com|region/i,
    );
    expect(() =>
      normalizeOkxEarn({
        code: "50119",
        msg: "API key doesn't exist",
        data: [],
      }),
    ).toThrow(/region|eea/i);
  });

  it("signOkxRequest matches HMAC-SHA256 base64 prehash", () => {
    const ts = "2020-12-08T09:08:57.715Z";
    const path = "/api/v5/finance/savings/lending-history?limit=100";
    const secret = "test-secret";
    const expected = createHmac("sha256", secret)
      .update(`${ts}GET${path}`)
      .digest("base64");
    expect(signOkxRequest(ts, "GET", path, "", secret)).toBe(expected);
  });

  it("resolveOkxApiBases pins when OKX_API_BASE is set", () => {
    process.env.OKX_API_BASE = "https://eea.okx.com/";
    expect(resolveOkxApiBases()).toEqual(["https://eea.okx.com"]);
  });

  it("resolveOkxApiBases lists global then EEA hosts by default", () => {
    expect(resolveOkxApiBases()).toEqual([
      "https://www.okx.com",
      "https://eea.okx.com",
      "https://my.okx.com",
    ]);
  });

  it("retries EEA base when www returns 50119", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).startsWith("https://www.okx.com")) {
        return {
          ok: false,
          status: 401,
          text: async () =>
            JSON.stringify({ code: "50119", msg: "API key doesn't exist" }),
        };
      }
      if (String(url).startsWith("https://eea.okx.com")) {
        return {
          ok: true,
          json: async () => load("lending-history.json"),
        };
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const events = await fetchOkxEarnEvents({
      apiKey: "k",
      apiSecret: "s",
      passphrase: "p",
    });
    expect(events).toHaveLength(2);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.startsWith("https://www.okx.com"))).toBe(true);
    expect(urls.some((u) => u.startsWith("https://eea.okx.com"))).toBe(true);
    // Sticky: second page (if any) should prefer eea — only one page here.
    expect(resolveOkxApiBases()[0]).toBe("https://eea.okx.com");
  });

  it("sends OK-ACCESS passphrase and sign headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => load("lending-empty.json"),
    });
    vi.stubGlobal("fetch", fetchMock);
    process.env.OKX_API_BASE = "https://www.okx.com";

    await fetchOkxEarnEvents({
      apiKey: "key-abc",
      apiSecret: "sec-xyz",
      passphrase: "pass-123",
    });

    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers["OK-ACCESS-KEY"]).toBe("key-abc");
    expect(init.headers["OK-ACCESS-PASSPHRASE"]).toBe("pass-123");
    expect(init.headers["OK-ACCESS-SIGN"]).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(init.headers["OK-ACCESS-TIMESTAMP"]).toMatch(
      /^\d{4}-\d{2}-\d{2}T.*Z$/,
    );
    expect(init.headers["x-simulated-trading"]).toBeUndefined();
  });

  it("adds x-simulated-trading when OKX_SIMULATED_TRADING=1", async () => {
    process.env.OKX_API_BASE = "https://www.okx.com";
    process.env.OKX_SIMULATED_TRADING = "1";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => load("lending-empty.json"),
    });
    vi.stubGlobal("fetch", fetchMock);
    await fetchOkxEarnEvents({
      apiKey: "k",
      apiSecret: "s",
      passphrase: "p",
    });
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers["x-simulated-trading"]).toBe("1");
  });

  it("does not regional-fallback on passphrase errors", async () => {
    process.env.OKX_API_BASE = undefined;
    delete process.env.OKX_API_BASE;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () =>
        JSON.stringify({ code: "50111", msg: "Invalid Passphrase" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchOkxEarnEvents({ apiKey: "k", apiSecret: "s", passphrase: "bad" }),
    ).rejects.toThrow(/passphrase/i);
    // Only tried www — not eea/my
    expect(fetchMock.mock.calls.length).toBe(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^https:\/\/www\.okx\.com/);
  });

  it("stops pagination when after cursor does not advance", async () => {
    process.env.OKX_API_BASE = "https://www.okx.com";
    const page = {
      code: "0",
      data: Array.from({ length: 100 }, (_, i) => ({
        ccy: "USDT",
        amt: String(i),
        ts: "1719792000000",
        productId: `p${i}`,
      })),
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => page,
    });
    vi.stubGlobal("fetch", fetchMock);
    const events = await fetchOkxEarnEvents({
      apiKey: "k",
      apiSecret: "s",
      passphrase: "p",
    });
    expect(events.length).toBe(100);
    // First page sets after=lastTs; second page detects stuck cursor and stops.
    expect(fetchMock.mock.calls.length).toBe(2);
  });

  it("fails closed on malformed row", () => {
    expect(() =>
      normalizeOkxEarn({
        code: "0",
        data: [{ ccy: "USDT", amt: "1", ts: "" }],
      }),
    ).toThrow(OkxAdapterError);
  });

  it("fetchOkxEarnEvents with API key", async () => {
    process.env.OKX_API_BASE = "https://www.okx.com";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => load("lending-history.json"),
      }),
    );
    const events = await fetchOkxEarnEvents({
      apiKey: "k",
      apiSecret: "s",
      passphrase: "p",
    });
    expect(events.length).toBe(2);
    expect(fetch).toHaveBeenCalled();
  });

  it("fetchOkxEarnEvents filters by date range and stops past start", async () => {
    process.env.OKX_API_BASE = "https://www.okx.com";
    const page = load("lending-history.json");
    // Fixture rows: 1719792000000 (2024-07-01) and 1719878400000 (2024-07-02)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => page,
      }),
    );
    const events = await fetchOkxEarnEvents(
      { apiKey: "k", apiSecret: "s", passphrase: "p" },
      {
        startMs: Date.parse("2024-07-02T00:00:00.000Z"),
        endMs: Date.parse("2024-07-02T23:59:59.999Z"),
      },
    );
    expect(events).toHaveLength(1);
    expect(events[0].asset).toBe("ETH");
    const url = String(
      (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0],
    );
    expect(url).toContain("after=");
  });

  it("fetchOkxEarnEvents with accessToken", async () => {
    process.env.OKX_API_BASE = "https://www.okx.com";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => load("lending-empty.json"),
      }),
    );
    const events = await fetchOkxEarnEvents({
      apiKey: "",
      apiSecret: "",
      accessToken: "tok",
    });
    expect(events).toEqual([]);
  });

  it("fetchOkxEarnEvents with accessToken HTTP error", async () => {
    process.env.OKX_API_BASE = "https://www.okx.com";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401 }),
    );
    await expect(
      fetchOkxEarnEvents({
        apiKey: "",
        apiSecret: "",
        accessToken: "tok",
      }),
    ).rejects.toThrow(/OAuth HTTP 401|HTTP 401/);
  });

  it("fetch fails closed on HTTP error", async () => {
    process.env.OKX_API_BASE = "https://www.okx.com";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "nope",
      }),
    );
    await expect(
      fetchOkxEarnEvents({ apiKey: "k", apiSecret: "s", passphrase: "p" }),
    ).rejects.toThrow(/HTTP 401/);
  });

  it("covers network failover, missing creds, 50119 body, and final throws", async () => {
    process.env.OKX_API_BASE = undefined;
    delete process.env.OKX_API_BASE;
    resetOkxBaseCache();

    // Network error on www → try eea → success
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).startsWith("https://www.okx.com")) {
        throw new Error("ECONNRESET");
      }
      return {
        ok: true,
        json: async () => load("lending-empty.json"),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchOkxEarnEvents({ apiKey: "k", apiSecret: "s", passphrase: "p" }),
    ).resolves.toEqual([]);

    // Missing key/secret/passphrase (no accessToken)
    await expect(
      fetchOkxEarnEvents({ apiKey: "", apiSecret: "", passphrase: "" }),
    ).rejects.toThrow(/Missing OKX credentials/);

    // OkxAdapterError from okxGetOnce rethrown
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new OkxAdapterError("direct", "50111");
      }),
    );
    // With pinned base so we don't regional-loop
    process.env.OKX_API_BASE = "https://www.okx.com";
    await expect(
      fetchOkxEarnEvents({ apiKey: "k", apiSecret: "s", passphrase: "p" }),
    ).rejects.toThrow(/direct/);

    // 50119 on last base with JSON body success status → final lastJson throw
    resetOkxBaseCache();
    process.env.OKX_API_BASE = "https://www.okx.com";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ code: "50119", msg: "API key doesn't exist" }),
      })),
    );
    await expect(
      fetchOkxEarnEvents({ apiKey: "k", apiSecret: "s", passphrase: "p" }),
    ).rejects.toThrow(/50119|region/i);

    // OAuth exhausts bases with non-json failure → last accessToken throw
    resetOkxBaseCache();
    delete process.env.OKX_API_BASE;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        text: async () => "upstream",
      })),
    );
    await expect(
      fetchOkxEarnEvents({
        apiKey: "",
        apiSecret: "",
        accessToken: "tok",
      }),
    ).rejects.toThrow(/OAuth HTTP|HTTP 503/);

    // API key exhausts with non-json → final HTTP throw
    process.env.OKX_API_BASE = "https://www.okx.com";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 502,
        text: async () => "bad gateway",
      })),
    );
    await expect(
      fetchOkxEarnEvents({ apiKey: "k", apiSecret: "s", passphrase: "p" }),
    ).rejects.toThrow(/HTTP 502/);

    // Filters rows newer than endMs
    process.env.OKX_API_BASE = "https://www.okx.com";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          code: "0",
          data: [
            {
              ccy: "USDT",
              amt: "1",
              ts: String(Date.parse("2024-08-01T00:00:00.000Z")),
              productId: "p",
            },
          ],
        }),
      }),
    );
    const filtered = await fetchOkxEarnEvents(
      { apiKey: "k", apiSecret: "s", passphrase: "p" },
      {
        startMs: Date.parse("2024-07-01T00:00:00.000Z"),
        endMs: Date.parse("2024-07-15T00:00:00.000Z"),
      },
    );
    expect(filtered).toEqual([]);
  });
});
