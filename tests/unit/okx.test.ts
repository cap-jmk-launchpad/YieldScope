import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OkxAdapterError,
  fetchOkxEarnEvents,
  normalizeOkxEarn,
} from "../../web/src/lib/adapters/okx";

const root = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/okx");

function load(name: string) {
  return JSON.parse(readFileSync(join(root, name), "utf8"));
}

describe("OKX earn adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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

  it("fails closed on malformed row", () => {
    expect(() =>
      normalizeOkxEarn({
        code: "0",
        data: [{ ccy: "USDT", amt: "1", ts: "" }],
      }),
    ).toThrow(OkxAdapterError);
  });

  it("fetchOkxEarnEvents with API key", async () => {
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

  it("fetchOkxEarnEvents with accessToken", async () => {
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
});
