import { createHmac } from "node:crypto";
import type { CexCredentials, EarnEvent, FetchEarnEvents } from "./types";

const OKX_BASE = process.env.OKX_API_BASE ?? "https://www.okx.com";

export interface OkxEarnRow {
  ccy: string;
  amt: string;
  ts: string;
  type?: string;
  productId?: string;
}

export interface OkxEarnResponse {
  code: string;
  msg?: string;
  data?: OkxEarnRow[];
}

export class OkxAdapterError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "OkxAdapterError";
  }
}

export function normalizeOkxEarn(payload: OkxEarnResponse): EarnEvent[] {
  if (payload.code !== "0") {
    throw new OkxAdapterError(
      payload.msg || `OKX error code ${payload.code}`,
      payload.code,
    );
  }
  const rows = payload.data ?? [];
  return rows.map((row, index) => {
    if (!row.ccy || row.amt == null || !row.ts) {
      throw new OkxAdapterError("Malformed OKX earn row");
    }
    return {
      id: `okx:${row.ts}:${row.ccy}:${row.productId ?? index}`,
      source: "okx" as const,
      asset: row.ccy,
      amount: String(row.amt),
      earnedAt: new Date(Number(row.ts)).toISOString(),
      rawType: row.type ?? "SAVINGS_INTEREST",
      meta: { productId: row.productId },
    };
  });
}

function signOkx(
  timestamp: string,
  method: string,
  pathWithQuery: string,
  body: string,
  secret: string,
): string {
  const prehash = `${timestamp}${method}${pathWithQuery}${body}`;
  return createHmac("sha256", secret).update(prehash).digest("base64");
}

async function okxGet(
  path: string,
  query: Record<string, string>,
  creds: CexCredentials,
): Promise<OkxEarnResponse> {
  const qs = new URLSearchParams(query).toString();
  const pathWithQuery = qs ? `${path}?${qs}` : path;

  if (creds.accessToken) {
    const res = await fetch(`${OKX_BASE}${pathWithQuery}`, {
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      throw new OkxAdapterError(`OKX OAuth HTTP ${res.status}`, String(res.status));
    }
    return res.json() as Promise<OkxEarnResponse>;
  }

  if (!creds.apiKey || !creds.apiSecret || !creds.passphrase) {
    throw new OkxAdapterError("Missing OKX credentials (key/secret/passphrase)");
  }

  const timestamp = new Date().toISOString();
  const sign = signOkx(timestamp, "GET", pathWithQuery, "", creds.apiSecret);
  const res = await fetch(`${OKX_BASE}${pathWithQuery}`, {
    headers: {
      "OK-ACCESS-KEY": creds.apiKey,
      "OK-ACCESS-SIGN": sign,
      "OK-ACCESS-TIMESTAMP": timestamp,
      "OK-ACCESS-PASSPHRASE": creds.passphrase,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new OkxAdapterError(
      `OKX HTTP ${res.status}: ${body.slice(0, 200)}`,
      String(res.status),
    );
  }
  return res.json() as Promise<OkxEarnResponse>;
}

/**
 * Fetch OKX savings / earn interest history.
 * Throws on API/auth failure — callers must fail closed (no fake rows).
 */
export const fetchOkxEarnEvents: FetchEarnEvents = async (creds) => {
  const events: EarnEvent[] = [];
  let after: string | undefined;

  for (let page = 0; page < 50; page += 1) {
    const query: Record<string, string> = { limit: "100" };
    if (after) query.after = after;

    const raw = await okxGet(
      "/api/v5/finance/savings/lending-history",
      query,
      creds,
    );
    const batch = normalizeOkxEarn(raw);
    events.push(...batch);

    if (batch.length === 0) break;
    const lastTs = raw.data?.[raw.data.length - 1]?.ts;
    if (!lastTs || batch.length < 100) break;
    after = lastTs;
  }

  return events;
};
