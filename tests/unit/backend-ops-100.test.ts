/**
 * Final push to 100% backend-ops coverage — nullish/fallback branches.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchOkxEarnEvents,
  OkxAdapterError,
  resetOkxBaseCache,
} from "../../web/src/lib/adapters/okx";
import {
  fetchBinanceEarnEvents,
  normalizeBinanceRewards,
} from "../../web/src/lib/adapters/binance";
import {
  normalizeLuncRewards,
  parseLuncAddress,
} from "../../web/src/lib/adapters/lunc-stake";
import { establishRecoverySession } from "../../web/src/lib/auth/recovery-session";
import {
  cexCoverageRefreshHint,
  parseSyncRangeBody,
} from "../../web/src/lib/sync-range";
import {
  defaultConvertAmount,
  earningsByCurrency,
  earningsByYear,
  earningsOverTime,
} from "../../web/src/lib/earnings-charts";
import {
  validateSavePayload,
  summarizeSavedSources,
} from "../../web/src/lib/credentials-db";

describe("backend-ops 100% branch closers", () => {
  const prevBase = process.env.OKX_API_BASE;

  beforeEach(() => {
    resetOkxBaseCache();
    delete process.env.OKX_API_BASE;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetOkxBaseCache();
    if (prevBase === undefined) delete process.env.OKX_API_BASE;
    else process.env.OKX_API_BASE = prevBase;
  });

  it("recovery-session evaluates error ?? \"\" when only error_code set", async () => {
    const client = {
      auth: {
        exchangeCodeForSession: vi.fn(),
        verifyOtp: vi.fn(),
        setSession: vi.fn(),
        getSession: vi.fn(),
      },
    };
    const result = await establishRecoverySession(
      client,
      "https://app.example/x?error_code=server_error",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("session_failed");
      expect(result.detail).toBeUndefined();
    }
  });

  it("okx readBody catch, last-base network throw, and 50119 regional break", async () => {
    // text() throws → readBody catch
    process.env.OKX_API_BASE = "https://www.okx.com";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => {
          throw new Error("no body");
        },
      })),
    );
    await expect(
      fetchOkxEarnEvents({ apiKey: "k", apiSecret: "s", passphrase: "p" }),
    ).rejects.toThrow();

    // Network error on last base (pinned) → throw OkxAdapterError
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw "not-an-error-object";
      }),
    );
    await expect(
      fetchOkxEarnEvents({ apiKey: "k", apiSecret: "s", passphrase: "p" }),
    ).rejects.toThrow(/OKX request failed/);

    // Error instance on last base
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNRESET");
      }),
    );
    await expect(
      fetchOkxEarnEvents({ apiKey: "k", apiSecret: "s", passphrase: "p" }),
    ).rejects.toThrow(/ECONNRESET/);

    // OAuth path without status → status || 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        text: async () => "oauth-fail",
      })),
    );
    await expect(
      fetchOkxEarnEvents({
        apiKey: "",
        apiSecret: "",
        accessToken: "tok",
      }),
    ).rejects.toThrow(/OAuth HTTP|HTTP/);

    // 50119 on 2xx body with multiple bases → break to next
    delete process.env.OKX_API_BASE;
    resetOkxBaseCache();
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).startsWith("https://www.okx.com")) {
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
      return {
        ok: true,
        status: 200,
        json: async () => ({ code: "0", data: [] }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchOkxEarnEvents({ apiKey: "k", apiSecret: "s", passphrase: "p" }),
    ).resolves.toEqual([]);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);

    // res.ok false without status → status || 0
    process.env.OKX_API_BASE = "https://www.okx.com";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        text: async () => "gone",
      })),
    );
    await expect(
      fetchOkxEarnEvents({ apiKey: "k", apiSecret: "s", passphrase: "p" }),
    ).rejects.toThrow(/HTTP 0|HTTP undefined|gone/i);
  });

  it("binance total falls back to batch.length", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          rows: [
            {
              asset: "USDT",
              rewards: "1",
              time: 1_719_792_000_000,
              projectId: "p1",
            },
          ],
          // no total
        }),
      })),
    );
    const events = await fetchBinanceEarnEvents(
      { apiKey: "k", apiSecret: "s" },
      {
        startMs: Date.parse("2024-07-01T00:00:00.000Z"),
        endMs: Date.parse("2024-07-02T00:00:00.000Z"),
      },
    );
    expect(events).toHaveLength(1);
    expect(normalizeBinanceRewards({ rows: undefined })).toEqual([]);
  });

  it("lunc reward ?? [] and query addr param", () => {
    expect(
      parseLuncAddress(
        "https://example.com/w?addr=terra1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a",
      ),
    ).toMatch(/^terra1/);
    expect(
      normalizeLuncRewards("terra1abc", {
        rewards: [{ validator_address: "val1" }],
      } as never),
    ).toEqual([]);
  });

  it("sync-range hint skips bad dates and covers non-string bounds", () => {
    const events = Array.from({ length: 50 }, (_, i) => ({
      source: "binance",
      earnedAt: i === 0 ? "not-a-date" : "2024-07-01T00:00:00.000Z",
    }));
    // all finite times identical after skipping bad → span 0 → hint
    expect(cexCoverageRefreshHint(events)).toMatch(/Re-download|null|few days/i);

    // all invalid dates → min/max stay ±Infinity → null
    expect(
      cexCoverageRefreshHint(
        Array.from({ length: 50 }, () => ({
          source: "okx",
          earnedAt: "nope",
        })),
      ),
    ).toBeNull();

    expect(
      parseSyncRangeBody({
        range: { mode: "custom", from: 1, to: 2 },
      }),
    ).toEqual({ mode: "custom", from: undefined, to: undefined });
    expect(parseSyncRangeBody({ from: 1, to: "2024-01-02" })).toEqual({
      mode: "custom",
      from: undefined,
      to: "2024-01-02",
    });
    // mode all with from set → skips inner from/to-both-null branch
    expect(parseSyncRangeBody({ mode: "all", from: "2024-01-01" })).toEqual({
      mode: "all",
    });
  });

  it("credentials validateSavePayload nullish key fields", () => {
    expect(
      validateSavePayload({
        binance: { apiKey: undefined as unknown as string, apiSecret: undefined as unknown as string },
      }).ok,
    ).toBe(false);
    expect(
      validateSavePayload({
        okx: {
          apiKey: undefined as unknown as string,
          apiSecret: undefined as unknown as string,
          passphrase: undefined as unknown as string,
        },
      }).ok,
    ).toBe(false);
    expect(
      validateSavePayload({
        binance: { apiKey: "", apiSecret: "s" },
      }).ok,
    ).toBe(false);
    expect(
      validateSavePayload({
        okx: { apiKey: "", apiSecret: "s", passphrase: "p" },
      }).ok,
    ).toBe(false);
    expect(
      summarizeSavedSources({
        binance: { configured: false },
        okx: { configured: false },
        monad_stake: { configured: false },
        lunc_stake: { configured: false },
      }),
    ).toBe("Nothing saved yet.");
  });

  it("earnings-charts covers skip and empty-grand paths", () => {
    expect(defaultConvertAmount("X", "1e309")).toBe(0);
    expect(
      earningsOverTime([
        {
          id: "1",
          source: "binance",
          asset: "USDT",
          amount: "1",
          earnedAt: "not-a-date",
        },
        {
          id: "2",
          source: "binance",
          asset: "USDT",
          amount: "0",
          earnedAt: "2024-01-01T00:00:00.000Z",
        },
      ]),
    ).toEqual([]);
    expect(
      earningsOverTime(
        [
          {
            id: "bad",
            source: "binance",
            asset: "USDT",
            amount: "1",
            earnedAt: "not-a-date",
          },
          {
            id: "1",
            source: "binance",
            asset: "USDT",
            amount: "1",
            earnedAt: "2024-01-01T00:00:00.000Z",
          },
          {
            id: "2",
            source: "binance",
            asset: "USDT",
            amount: "0",
            earnedAt: "2024-01-02T00:00:00.000Z",
          },
        ],
        {
          convertAmount: (_a, amount) =>
            amount === "0" ? 0 : Number.NaN,
        },
      ),
    ).toEqual([]);
    // convert path equal totals → localeCompare
    expect(
      earningsByCurrency(
        [
          {
            id: "1",
            source: "binance",
            asset: "B",
            amount: "1",
            earnedAt: "2024-01-01T00:00:00.000Z",
          },
          {
            id: "2",
            source: "binance",
            asset: "A",
            amount: "1",
            earnedAt: "2024-01-01T00:00:00.000Z",
          },
        ],
        { convertAmount: () => 5 },
      ).map((s) => s.asset),
    ).toEqual(["A", "B"]);
    expect(
      earningsByYear([
        {
          id: "1",
          source: "binance",
          asset: "USDT",
          amount: "0",
          earnedAt: "2024-01-01T00:00:00.000Z",
        },
        {
          id: "2",
          source: "binance",
          asset: "USDT",
          amount: "1",
          earnedAt: "bad",
        },
      ]),
    ).toEqual([]);
    expect(
      earningsByCurrency([
        {
          id: "1",
          source: "binance",
          asset: "   ",
          amount: "1",
          earnedAt: "2024-01-01T00:00:00.000Z",
        },
      ]),
    ).toEqual([{ asset: "UNKNOWN", total: 1, share: 1 }]);
    expect(
      earningsByCurrency([
        {
          id: "1",
          source: "binance",
          asset: "A",
          amount: "0",
          earnedAt: "2024-01-01T00:00:00.000Z",
        },
      ]),
    ).toEqual([]);
    expect(
      earningsByCurrency([
        {
          id: "1",
          source: "binance",
          asset: "B",
          amount: "5",
          earnedAt: "2024-01-01T00:00:00.000Z",
        },
        {
          id: "2",
          source: "binance",
          asset: "A",
          amount: "5",
          earnedAt: "2024-01-01T00:00:00.000Z",
        },
      ]).map((s) => s.asset),
    ).toEqual(["A", "B"]);
    expect(
      earningsByCurrency(
        [
          {
            id: "1",
            source: "binance",
            asset: "USDT",
            amount: "1",
            earnedAt: "2024-01-01T00:00:00.000Z",
          },
        ],
        { convertAmount: () => 0 },
      ),
    ).toEqual([]);
  });
});
