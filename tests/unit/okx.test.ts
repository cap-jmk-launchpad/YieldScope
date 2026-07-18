import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OkxAdapterError,
  assetBillToEarnEvent,
  accountBillToEarnEvent,
  fetchOkxEarnEvents,
  formatOkxApiError,
  lendingInterestAmount,
  normalizeOkxAccountEarnBills,
  normalizeOkxAssetBills,
  normalizeOkxEarn,
  resetOkxBaseCache,
  resolveOkxApiBases,
  signOkxRequest,
} from "../../web/src/lib/adapters/okx";

const root = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/okx");

function load(name: string) {
  return JSON.parse(readFileSync(join(root, name), "utf8"));
}

/** Route OKX paths so lending / bills / balance fixtures don't collide. */
function okxFetchRouter(
  routes: Record<string, unknown>,
  fallback: unknown = load("lending-empty.json"),
) {
  return vi.fn(async (url: string) => {
    const u = String(url);
    for (const [needle, body] of Object.entries(routes)) {
      if (u.includes(needle)) {
        return { ok: true, status: 200, json: async () => body };
      }
    }
    return { ok: true, status: 200, json: async () => fallback };
  });
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

  it("resolveOkxApiBases lists EEA then openapi/global hosts by default", () => {
    expect(resolveOkxApiBases()).toEqual([
      "https://eea.okx.com",
      "https://openapi.okx.com",
      "https://www.okx.com",
      "https://my.okx.com",
    ]);
  });

  it("retries EEA base when www returns 50119", async () => {
    // Force www-first via sticky so we still exercise regional fallback.
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).startsWith("https://www.okx.com")) {
        return {
          ok: false,
          status: 401,
          text: async () =>
            JSON.stringify({ code: "50119", msg: "API key doesn't exist" }),
        };
      }
      if (String(url).startsWith("https://openapi.okx.com")) {
        return {
          ok: false,
          status: 401,
          text: async () =>
            JSON.stringify({ code: "50119", msg: "API key doesn't exist" }),
        };
      }
      if (String(url).startsWith("https://eea.okx.com")) {
        // Lending succeeds; other paths empty so bills don't invent rows.
        if (String(url).includes("lending-history")) {
          return {
            ok: true,
            json: async () => load("lending-history.json"),
          };
        }
        return {
          ok: true,
          json: async () => load("lending-empty.json"),
        };
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    // Direct probe with sticky cleared — EEA succeeds first for EEA keys.
    resetOkxBaseCache();
    const events = await fetchOkxEarnEvents({
      apiKey: "k",
      apiSecret: "s",
      passphrase: "p",
    });
    expect(events).toHaveLength(2);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toMatch(/^https:\/\/eea\.okx\.com/);
    expect(resolveOkxApiBases()[0]).toBe("https://eea.okx.com");
  });

  it("falls back from sticky www to EEA on 50119 and clears sticky", async () => {
    // First establish sticky www via a successful www response, then flip to 50119.
    let phase: "seed" | "fail401" = "seed";
    const reject50119 = {
      ok: false,
      status: 401,
      text: async () =>
        JSON.stringify({ code: "50119", msg: "API key doesn't exist" }),
    };
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (phase === "seed" && u.startsWith("https://eea.okx.com")) {
        return reject50119;
      }
      if (phase === "seed" && u.startsWith("https://openapi.okx.com")) {
        return reject50119;
      }
      if (phase === "seed" && u.startsWith("https://www.okx.com")) {
        return {
          ok: true,
          json: async () => load("lending-empty.json"),
        };
      }
      if (phase === "fail401" && u.startsWith("https://www.okx.com")) {
        return reject50119;
      }
      if (phase === "fail401" && u.startsWith("https://openapi.okx.com")) {
        return reject50119;
      }
      if (phase === "fail401" && u.startsWith("https://eea.okx.com")) {
        if (u.includes("lending-history")) {
          return {
            ok: true,
            json: async () => load("lending-history.json"),
          };
        }
        return {
          ok: true,
          json: async () => load("lending-empty.json"),
        };
      }
      if (u.startsWith("https://my.okx.com")) {
        return reject50119;
      }
      throw new Error(`unexpected url ${u} phase=${phase}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchOkxEarnEvents({
      apiKey: "k",
      apiSecret: "s",
      passphrase: "p",
    });
    expect(resolveOkxApiBases()[0]).toBe("https://www.okx.com");

    phase = "fail401";
    const events = await fetchOkxEarnEvents({
      apiKey: "k",
      apiSecret: "s",
      passphrase: "p",
    });
    expect(events).toHaveLength(2);
    expect(resolveOkxApiBases()[0]).toBe("https://eea.okx.com");

    // Re-seed sticky www, then clear via 2xx+50119 (distinct from HTTP 401 path).
    phase = "seed";
    await fetchOkxEarnEvents({
      apiKey: "k",
      apiSecret: "s",
      passphrase: "p",
    });
    expect(resolveOkxApiBases()[0]).toBe("https://www.okx.com");

    const fetch2xx = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.startsWith("https://www.okx.com") || u.startsWith("https://openapi.okx.com")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            code: "50119",
            msg: "API key doesn't exist",
            data: [],
          }),
        };
      }
      if (u.startsWith("https://eea.okx.com")) {
        if (u.includes("lending-history")) {
          return {
            ok: true,
            json: async () => load("lending-history.json"),
          };
        }
        return {
          ok: true,
          json: async () => load("lending-empty.json"),
        };
      }
      return {
        ok: false,
        status: 401,
        text: async () =>
          JSON.stringify({ code: "50119", msg: "API key doesn't exist" }),
      };
    });
    vi.stubGlobal("fetch", fetch2xx);
    const cleared = await fetchOkxEarnEvents({
      apiKey: "k",
      apiSecret: "s",
      passphrase: "p",
    });
    expect(cleared).toHaveLength(2);
    expect(resolveOkxApiBases()[0]).toBe("https://eea.okx.com");
  });

  it("sends OK-ACCESS passphrase and sign headers", async () => {
    const fetchMock = okxFetchRouter({});
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
    const fetchMock = okxFetchRouter({});
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
    // Only tried first regional host — not the rest
    expect(fetchMock.mock.calls.length).toBe(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^https:\/\/eea\.okx\.com/);
  });

  it("stops pagination when after cursor does not advance", async () => {
    process.env.OKX_API_BASE = "https://www.okx.com";
    const page = {
      code: "0",
      data: Array.from({ length: 100 }, (_, i) => ({
        ccy: "USDT",
        amt: "1000",
        earnings: String(i + 1),
        ts: "1719792000000",
        productId: `p${i}`,
      })),
    };
    const fetchMock = okxFetchRouter(
      { "lending-history": page },
      load("lending-empty.json"),
    );
    vi.stubGlobal("fetch", fetchMock);
    const events = await fetchOkxEarnEvents({
      apiKey: "k",
      apiSecret: "s",
      passphrase: "p",
    });
    expect(events.length).toBe(100);
    const lendingCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("lending-history"),
    );
    // First page sets after=lastTs; second page detects stuck cursor and stops.
    expect(lendingCalls.length).toBe(2);
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
      okxFetchRouter({ "lending-history": load("lending-history.json") }),
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
      okxFetchRouter({ "lending-history": page }),
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
    const lendingUrl = String(
      (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
        String(c[0]).includes("lending-history"),
      )?.[0],
    );
    expect(lendingUrl).toContain("after=");
  });

  it("fetchOkxEarnEvents with accessToken", async () => {
    process.env.OKX_API_BASE = "https://www.okx.com";
    vi.stubGlobal("fetch", okxFetchRouter({}));
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

    // Network error on EEA (first base) → try next region → success
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).startsWith("https://eea.okx.com")) {
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
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);

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
      okxFetchRouter({
        "lending-history": {
          code: "0",
          data: [
            {
              ccy: "USDT",
              amt: "1000",
              earnings: "1",
              ts: String(Date.parse("2024-08-01T00:00:00.000Z")),
              productId: "p",
            },
          ],
        },
        "savings/balance": load("lending-empty.json"),
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

  it("normalizes asset interest bills and skips non-earn types", () => {
    const events = normalizeOkxAssetBills(load("asset-bills-interest.json"));
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      source: "okx",
      asset: "USDT",
      amount: "1.25",
      rawType: "ASSET_BILL_400",
    });
    expect(events[1].asset).toBe("ETH");
    expect(events[2]).toMatchObject({
      asset: "USDC",
      rawType: "ASSET_BILL_126",
    });
    expect(
      assetBillToEarnEvent({
        billId: "x",
        ccy: "USDT",
        balChg: "-1",
        type: "400",
        ts: "1",
      }),
    ).toBeNull();
  });

  it("uses lending earnings (not principal amt) for interest rows", () => {
    const events = normalizeOkxEarn({
      code: "0",
      data: [
        {
          ccy: "USDT",
          amt: "1000",
          earnings: "0.55",
          ts: "1719792000000",
        },
        {
          ccy: "ETH",
          amt: "2",
          earnings: "0",
          ts: "1719878400000",
        },
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0].amount).toBe("0.55");
  });

  it("normalizes account earnAmt and ignores empty earnAmt trades", () => {
    const events = normalizeOkxAccountEarnBills(
      load("account-bills-earn.json"),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      asset: "USDT",
      amount: "0.42",
      rawType: "ACCOUNT_EARN",
    });
    expect(
      accountBillToEarnEvent({
        billId: "t",
        ccy: "USDT",
        ts: "1",
        earnAmt: "",
      }),
    ).toBeNull();
  });

  it("merges Auto lend interest bills (type 400) when lending-history is empty", async () => {
    process.env.OKX_API_BASE = "https://www.okx.com";
    const fetchMock = okxFetchRouter({
      "lending-history": load("lending-empty.json"),
      "savings/balance": load("savings-balance.json"),
      "asset/bills": load("asset-bills-interest.json"),
      "asset/bills-history": load("lending-empty.json"),
      "account/bills": load("lending-empty.json"),
      "account/bills-archive": load("lending-empty.json"),
    });
    vi.stubGlobal("fetch", fetchMock);

    const events = await fetchOkxEarnEvents({
      apiKey: "k",
      apiSecret: "s",
      passphrase: "p",
    });

    // type 400 + legacy 126; redemption type 76 dropped
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.rawType).sort()).toEqual([
      "ASSET_BILL_126",
      "ASSET_BILL_400",
      "ASSET_BILL_400",
    ]);
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes("type=400")),
    ).toBe(true);
    // Asset bills paginate by timestamp, not billId.
    const billUrl = String(
      fetchMock.mock.calls.find((c) => String(c[0]).includes("asset/bills?"))?.[0] ??
        "",
    );
    expect(billUrl).toContain("type=400");
  });

  it("merges account Auto Earn type=381 earnAmt when lending-history is empty", async () => {
    process.env.OKX_API_BASE = "https://www.okx.com";
    const fetchMock = okxFetchRouter({
      "lending-history": load("lending-empty.json"),
      "savings/balance": load("lending-empty.json"),
      "asset/bills": load("lending-empty.json"),
      "asset/bills-history": load("lending-empty.json"),
      "account/bills": load("account-bills-earn.json"),
      "account/bills-archive": load("lending-empty.json"),
    });
    vi.stubGlobal("fetch", fetchMock);

    const events = await fetchOkxEarnEvents({
      apiKey: "k",
      apiSecret: "s",
      passphrase: "p",
    });
    expect(events).toHaveLength(1);
    expect(events[0].rawType).toBe("ACCOUNT_EARN");
    expect(events[0].amount).toBe("0.42");
    expect(
      fetchMock.mock.calls.some((c) =>
        String(c[0]).includes("account/bills") &&
        String(c[0]).includes("type=381"),
      ),
    ).toBe(true);
  });

  it("fails closed when streams empty but savings balance shows principal", async () => {
    process.env.OKX_API_BASE = "https://www.okx.com";
    vi.stubGlobal(
      "fetch",
      okxFetchRouter({
        "lending-history": load("lending-empty.json"),
        "savings/balance": load("savings-balance.json"),
        "asset/bills": load("lending-empty.json"),
        "asset/bills-history": load("lending-empty.json"),
        "account/bills": load("lending-empty.json"),
        "account/bills-archive": load("lending-empty.json"),
      }),
    );

    await expect(
      fetchOkxEarnEvents({
        apiKey: "k",
        apiSecret: "s",
        passphrase: "p",
      }),
    ).rejects.toThrow(/no interest history.*savings balance/i);
  });

  it("retries lending-history per savings balance ccy when unfiltered is empty", async () => {
    process.env.OKX_API_BASE = "https://www.okx.com";
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("lending-history") && u.includes("ccy=USDT")) {
        return {
          ok: true,
          json: async () => load("lending-history.json"),
        };
      }
      if (u.includes("lending-history")) {
        return { ok: true, json: async () => load("lending-empty.json") };
      }
      if (u.includes("savings/balance")) {
        return { ok: true, json: async () => load("savings-balance.json") };
      }
      return { ok: true, json: async () => load("lending-empty.json") };
    });
    vi.stubGlobal("fetch", fetchMock);

    const events = await fetchOkxEarnEvents({
      apiKey: "k",
      apiSecret: "s",
      passphrase: "p",
    });
    expect(events).toHaveLength(2);
    expect(
      fetchMock.mock.calls.some((c) =>
        String(c[0]).includes("lending-history") &&
        String(c[0]).includes("ccy=USDT"),
      ),
    ).toBe(true);
  });

  it("uses legacy amt when earnings key is absent (fail-closed on empty/non-positive)", () => {
    expect(
      lendingInterestAmount({ ccy: "USDT", amt: "1.5", ts: "1" }),
    ).toBe("1.5");
    expect(
      lendingInterestAmount({ ccy: "USDT", amt: "", ts: "1" }),
    ).toBeNull();
    expect(
      lendingInterestAmount({ ccy: "USDT", amt: undefined, ts: "1" }),
    ).toBeNull();
    expect(
      lendingInterestAmount({ ccy: "USDT", amt: "0", ts: "1" }),
    ).toBeNull();
    expect(
      lendingInterestAmount({ ccy: "USDT", amt: "nope", ts: "1" }),
    ).toBeNull();
    expect(
      lendingInterestAmount({ ccy: "USDT", earnings: null, ts: "1" }),
    ).toBeNull();
    expect(
      normalizeOkxEarn({
        code: "0",
        data: [{ ccy: "BTC", amt: "0.01", ts: "1719792000000", type: "1" }],
      }),
    ).toHaveLength(1);
  });

  it("fails closed on malformed asset bills and API error payloads", () => {
    expect(() =>
      assetBillToEarnEvent({
        type: "400",
        ccy: "",
        balChg: "1",
        ts: "1",
      }),
    ).toThrow(/Malformed OKX asset bill/);
    expect(() =>
      assetBillToEarnEvent({
        type: "400",
        ccy: "USDT",
        balChg: "1",
        ts: "",
      }),
    ).toThrow(/Malformed OKX asset bill/);
    expect(
      assetBillToEarnEvent({
        type: "400",
        ccy: "USDT",
        balChg: "NaN",
        ts: "1",
      }),
    ).toBeNull();
    expect(
      assetBillToEarnEvent({
        type: "408",
        ccy: "USDG",
        balChg: "0.08",
        ts: "1735776000000",
      }),
    ).toMatchObject({ rawType: "ASSET_BILL_408", amount: "0.08" });
    // billId fallback when omitted
    expect(
      assetBillToEarnEvent({
        type: "400",
        ccy: "USDT",
        balChg: "1",
        ts: "99",
      })?.id,
    ).toBe("okx:bill:99:USDT:1:400");
    expect(() =>
      normalizeOkxAssetBills({ code: "50000", msg: "bills down", data: [] }),
    ).toThrow(/bills down/);
    expect(() =>
      normalizeOkxAccountEarnBills({
        code: "50001",
        msg: "acct down",
        data: [],
      }),
    ).toThrow(/acct down/);
    expect(
      accountBillToEarnEvent({
        ccy: "USDT",
        ts: "10",
        earnAmt: "0.5",
      })?.id,
    ).toBe("okx:acct:10:USDT:0.5");
    expect(
      accountBillToEarnEvent({
        ccy: "USDT",
        ts: "10",
        earnAmt: "0",
      }),
    ).toBeNull();
    expect(
      accountBillToEarnEvent({
        ccy: "USDT",
        ts: "10",
        earnAmt: "x",
      }),
    ).toBeNull();
    expect(
      accountBillToEarnEvent({
        ccy: "",
        ts: "10",
        earnAmt: "1",
      }),
    ).toBeNull();
  });

  it("merges USDG auto-earn type 408 asset bills", async () => {
    process.env.OKX_API_BASE = "https://www.okx.com";
    const fetchMock = okxFetchRouter({
      "lending-history": load("lending-empty.json"),
      "savings/balance": load("lending-empty.json"),
      "asset/bills": load("asset-bills-usdg-408.json"),
      "asset/bills-history": load("lending-empty.json"),
      "account/bills": load("lending-empty.json"),
      "account/bills-archive": load("lending-empty.json"),
    });
    vi.stubGlobal("fetch", fetchMock);
    const events = await fetchOkxEarnEvents({
      apiKey: "k",
      apiSecret: "s",
      passphrase: "p",
    });
    expect(events).toHaveLength(1);
    expect(events[0].rawType).toBe("ASSET_BILL_408");
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes("type=408")),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(
        (c) =>
          String(c[0]).includes("bills-history") &&
          String(c[0]).includes("pagingType=1"),
      ),
    ).toBe(true);
  });

  it("fails closed when streams empty but balance shows cumulative earnings only", async () => {
    process.env.OKX_API_BASE = "https://www.okx.com";
    vi.stubGlobal(
      "fetch",
      okxFetchRouter({
        "lending-history": load("lending-empty.json"),
        "savings/balance": load("savings-balance-earnings-only.json"),
        "asset/bills": load("lending-empty.json"),
        "asset/bills-history": load("lending-empty.json"),
        "account/bills": load("lending-empty.json"),
        "account/bills-archive": load("lending-empty.json"),
      }),
    );
    await expect(
      fetchOkxEarnEvents({
        apiKey: "k",
        apiSecret: "s",
        passphrase: "p",
      }),
    ).rejects.toThrow(/no interest history.*savings balance/i);
  });

  it("throws when asset bills API returns non-zero code mid-fetch", async () => {
    process.env.OKX_API_BASE = "https://www.okx.com";
    vi.stubGlobal(
      "fetch",
      okxFetchRouter({
        "lending-history": load("lending-empty.json"),
        "savings/balance": load("lending-empty.json"),
        "asset/bills": { code: "51000", msg: "asset bills failed", data: [] },
        "asset/bills-history": load("lending-empty.json"),
        "account/bills": load("lending-empty.json"),
        "account/bills-archive": load("lending-empty.json"),
      }),
    );
    await expect(
      fetchOkxEarnEvents({
        apiKey: "k",
        apiSecret: "s",
        passphrase: "p",
      }),
    ).rejects.toThrow(/asset bills failed/);
  });

  it("throws when account bills API returns non-zero code mid-fetch", async () => {
    process.env.OKX_API_BASE = "https://www.okx.com";
    vi.stubGlobal(
      "fetch",
      okxFetchRouter({
        "lending-history": load("lending-empty.json"),
        "savings/balance": load("lending-empty.json"),
        "asset/bills": load("lending-empty.json"),
        "asset/bills-history": load("lending-empty.json"),
        "account/bills": {
          code: "51001",
          msg: "account bills failed",
          data: [],
        },
        "account/bills-archive": load("lending-empty.json"),
      }),
    );
    await expect(
      fetchOkxEarnEvents({
        apiKey: "k",
        apiSecret: "s",
        passphrase: "p",
      }),
    ).rejects.toThrow(/account bills failed/);
  });

  it("paginates asset bills by timestamp and stops on stuck after cursor", async () => {
    process.env.OKX_API_BASE = "https://www.okx.com";
    const baseTs = 1_722_470_400_000;
    const fullPage = {
      code: "0",
      data: Array.from({ length: 100 }, (_, i) => ({
        billId: `b${i}`,
        ccy: "USDT",
        balChg: "0.01",
        type: "400",
        ts: String(baseTs + i),
      })),
    };
    let assetBillPages = 0;
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("asset/bills?") && u.includes("type=400")) {
        assetBillPages += 1;
        return { ok: true, json: async () => fullPage };
      }
      return { ok: true, json: async () => load("lending-empty.json") };
    });
    vi.stubGlobal("fetch", fetchMock);
    const events = await fetchOkxEarnEvents({
      apiKey: "k",
      apiSecret: "s",
      passphrase: "p",
    });
    expect(events.length).toBe(100);
    expect(assetBillPages).toBeGreaterThanOrEqual(2);
    const afterUrls = fetchMock.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes("asset/bills?") && u.includes("after="));
    expect(afterUrls.length).toBeGreaterThanOrEqual(1);
    expect(afterUrls[0]).toContain(`after=${baseTs + 99}`);
  });

  it("stops asset-bill pagination once past startMs (skip_old)", async () => {
    process.env.OKX_API_BASE = "https://www.okx.com";
    const startMs = Date.parse("2024-08-01T00:00:00.000Z");
    const endMs = Date.parse("2024-08-31T00:00:00.000Z");
    const page = {
      code: "0",
      data: [
        {
          billId: "new",
          ccy: "USDT",
          balChg: "1",
          type: "400",
          ts: String(Date.parse("2024-09-01T00:00:00.000Z")),
        },
        {
          billId: "in-window",
          ccy: "USDT",
          balChg: "2",
          type: "400",
          ts: String(Date.parse("2024-08-15T00:00:00.000Z")),
        },
        {
          billId: "old",
          ccy: "USDT",
          balChg: "3",
          type: "400",
          ts: String(Date.parse("2024-07-01T00:00:00.000Z")),
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      okxFetchRouter({
        "lending-history": load("lending-empty.json"),
        "savings/balance": load("lending-empty.json"),
        "asset/bills": page,
        "asset/bills-history": load("lending-empty.json"),
        "account/bills": load("lending-empty.json"),
        "account/bills-archive": load("lending-empty.json"),
      }),
    );
    const events = await fetchOkxEarnEvents(
      { apiKey: "k", apiSecret: "s", passphrase: "p" },
      { startMs, endMs },
    );
    expect(events).toHaveLength(1);
    expect(events[0].id).toContain("in-window");
  });

  it("paginates account Auto Earn bills by billId and stops on stuck cursor", async () => {
    process.env.OKX_API_BASE = "https://www.okx.com";
    const baseTs = 1_722_729_600_000;
    const fullPage = {
      code: "0",
      data: Array.from({ length: 100 }, (_, i) => ({
        billId: `acct-${i}`,
        ccy: "USDT",
        ts: String(baseTs + i),
        type: "381",
        earnAmt: "0.01",
      })),
    };
    let accountPages = 0;
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("account/bills?") && u.includes("type=381")) {
        accountPages += 1;
        return { ok: true, json: async () => fullPage };
      }
      return { ok: true, json: async () => load("lending-empty.json") };
    });
    vi.stubGlobal("fetch", fetchMock);
    const events = await fetchOkxEarnEvents({
      apiKey: "k",
      apiSecret: "s",
      passphrase: "p",
    });
    expect(events.length).toBe(100);
    expect(accountPages).toBeGreaterThanOrEqual(2);
    expect(
      fetchMock.mock.calls.some(
        (c) =>
          String(c[0]).includes("account/bills?") &&
          String(c[0]).includes("after=acct-99"),
      ),
    ).toBe(true);
  });

  it("stops account-bill pagination on skip_old and sparse earnAmt raw scan", async () => {
    process.env.OKX_API_BASE = "https://www.okx.com";
    const startMs = Date.parse("2024-08-01T00:00:00.000Z");
    const endMs = Date.parse("2024-08-31T00:00:00.000Z");

    // First: earnAmt rows that are skip_new / keep / skip_old
    const earnPage = {
      code: "0",
      data: [
        {
          billId: "a-new",
          ccy: "USDT",
          ts: String(Date.parse("2024-09-01T00:00:00.000Z")),
          type: "381",
          earnAmt: "1",
        },
        {
          billId: "a-keep",
          ccy: "USDT",
          ts: String(Date.parse("2024-08-10T00:00:00.000Z")),
          type: "381",
          earnAmt: "2",
        },
        {
          billId: "a-old",
          ccy: "USDT",
          ts: String(Date.parse("2024-07-01T00:00:00.000Z")),
          type: "381",
          earnAmt: "3",
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      okxFetchRouter({
        "lending-history": load("lending-empty.json"),
        "savings/balance": load("lending-empty.json"),
        "asset/bills": load("lending-empty.json"),
        "asset/bills-history": load("lending-empty.json"),
        "account/bills": earnPage,
        "account/bills-archive": load("lending-empty.json"),
      }),
    );
    const withEarn = await fetchOkxEarnEvents(
      { apiKey: "k", apiSecret: "s", passphrase: "p" },
      { startMs, endMs },
    );
    expect(withEarn).toHaveLength(1);
    expect(withEarn[0].amount).toBe("2");

    // Sparse earnAmt: empty interest but raw ts older than start → raw scan stop
    const sparsePage = {
      code: "0",
      data: Array.from({ length: 100 }, (_, i) => ({
        billId: `sparse-${i}`,
        ccy: "USDT",
        ts: String(Date.parse("2024-06-01T00:00:00.000Z") + i),
        type: "381",
        earnAmt: "",
      })),
    };
    let archivePages = 0;
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("account/bills-archive")) {
        archivePages += 1;
        return { ok: true, json: async () => sparsePage };
      }
      if (u.includes("account/bills?")) {
        return { ok: true, json: async () => load("lending-empty.json") };
      }
      return { ok: true, json: async () => load("lending-empty.json") };
    });
    vi.stubGlobal("fetch", fetchMock);
    const sparse = await fetchOkxEarnEvents(
      { apiKey: "k", apiSecret: "s", passphrase: "p" },
      { startMs, endMs },
    );
    expect(sparse).toEqual([]);
    // One archive page then stop via raw-scan hitOlderThanStart (no 2nd page)
    expect(archivePages).toBe(1);
  });

  it("dedupes identical earn events across streams", async () => {
    process.env.OKX_API_BASE = "https://www.okx.com";
    const bill = load("asset-bills-auto-lend.json");
    vi.stubGlobal(
      "fetch",
      okxFetchRouter({
        "lending-history": load("lending-empty.json"),
        "savings/balance": load("lending-empty.json"),
        "asset/bills": bill,
        "asset/bills-history": bill,
        "account/bills": load("lending-empty.json"),
        "account/bills-archive": load("lending-empty.json"),
      }),
    );
    const events = await fetchOkxEarnEvents({
      apiKey: "k",
      apiSecret: "s",
      passphrase: "p",
    });
    expect(events).toHaveLength(1);
  });

  it("covers undefined data payloads and OAuth status fallbacks", async () => {
    expect(normalizeOkxAssetBills({ code: "0" })).toEqual([]);
    expect(normalizeOkxAccountEarnBills({ code: "0" })).toEqual([]);
    expect(normalizeOkxEarn({ code: "0" })).toEqual([]);

    process.env.OKX_API_BASE = "https://www.okx.com";
    // lending + balance + bills with missing data arrays
    vi.stubGlobal(
      "fetch",
      okxFetchRouter({
        "lending-history": { code: "0" },
        "savings/balance": { code: "0" },
        "asset/bills": { code: "0" },
        "asset/bills-history": { code: "0" },
        "account/bills": { code: "0" },
        "account/bills-archive": { code: "0" },
      }),
    );
    await expect(
      fetchOkxEarnEvents({
        apiKey: "k",
        apiSecret: "s",
        passphrase: "p",
      }),
    ).resolves.toEqual([]);

    // OAuth success without status → status || 200
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ code: "0", data: [] }),
      })),
    );
    await expect(
      fetchOkxEarnEvents({
        apiKey: "",
        apiSecret: "",
        accessToken: "tok",
      }),
    ).resolves.toEqual([]);

    // savings balance non-zero code fail-closed
    vi.stubGlobal(
      "fetch",
      okxFetchRouter({
        "savings/balance": { code: "50113", msg: "Invalid Passphrase" },
      }),
    );
    await expect(
      fetchOkxEarnEvents({
        apiKey: "k",
        apiSecret: "s",
        passphrase: "p",
      }),
    ).rejects.toThrow(/passphrase/i);

    // asset bill without type → null; account earnAmt null → null
    expect(
      assetBillToEarnEvent({
        ccy: "USDT",
        balChg: "1",
        ts: "1",
        type: "" as unknown as string,
      }),
    ).toBeNull();
    expect(
      accountBillToEarnEvent({
        ccy: "USDT",
        ts: "1",
        earnAmt: undefined,
      }),
    ).toBeNull();
  });

  it("covers savings earnings else-path and lending length ?? 0", async () => {
    process.env.OKX_API_BASE = "https://www.okx.com";

    // hasPrincipal true, hasReportedEarnings stays false (earn not > 0 / non-finite)
    vi.stubGlobal(
      "fetch",
      okxFetchRouter({
        "lending-history": load("lending-empty.json"),
        "savings/balance": {
          code: "0",
          data: [
            { ccy: "USDT", amt: "100", earnings: "0" },
            { ccy: "ETH", amt: "1", earnings: "nope" },
          ],
        },
        "asset/bills": load("lending-empty.json"),
        "asset/bills-history": load("lending-empty.json"),
        "account/bills": load("lending-empty.json"),
        "account/bills-archive": load("lending-empty.json"),
      }),
    );
    await expect(
      fetchOkxEarnEvents({
        apiKey: "k",
        apiSecret: "s",
        passphrase: "p",
      }),
    ).rejects.toThrow(/no interest history.*savings balance/i);

    // Array-like lending page: length nullish → `?? 0` while lastTs still resolves
    const row = {
      ccy: "USDT",
      amt: "1",
      earnings: "0.01",
      ts: "1719792000000",
    };
    // null - 1 === -1 in JS, so lastTs reads data[-1] after length is null.
    const weirdPage: Record<string | number, unknown> & {
      length: null;
      [Symbol.iterator]: () => Generator<typeof row>;
    } = {
      length: null,
      [-1]: { ...row, productId: "tail" },
      [Symbol.iterator]: function* () {
        for (let i = 0; i < 100; i += 1) yield this[i] as typeof row;
      },
    };
    for (let i = 0; i < 100; i += 1) {
      weirdPage[i] = { ...row, productId: `p${i}` };
    }
    vi.stubGlobal(
      "fetch",
      okxFetchRouter({
        "lending-history": { code: "0", data: weirdPage },
        "savings/balance": load("lending-empty.json"),
        "asset/bills": load("lending-empty.json"),
        "asset/bills-history": load("lending-empty.json"),
        "account/bills": load("lending-empty.json"),
        "account/bills-archive": load("lending-empty.json"),
      }),
    );
    const events = await fetchOkxEarnEvents({
      apiKey: "k",
      apiSecret: "s",
      passphrase: "p",
    });
    expect(events.length).toBe(100);
  });
});
