import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  OkxAdapterError,
  normalizeOkxEarn,
} from "../../web/src/lib/adapters/okx";

const root = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/okx");

function load(name: string) {
  return JSON.parse(readFileSync(join(root, name), "utf8"));
}

describe("OKX earn adapter", () => {
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
    expect(() => normalizeOkxEarn(load("error-auth.json"))).toThrow(OkxAdapterError);
  });

  it("fails closed on malformed row", () => {
    expect(() =>
      normalizeOkxEarn({
        code: "0",
        data: [{ ccy: "USDT", amt: "1", ts: "" }],
      }),
    ).toThrow(OkxAdapterError);
  });
});
