import { createHmac } from "node:crypto";
import type {
  CexCredentials,
  EarnEvent,
  EarnFetchOptions,
  FetchEarnEvents,
} from "./types";

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readBody(res: Response): Promise<string> {
  if (typeof res.text !== "function") return "";
  try {
    return await res.text();
  } catch {
    return "";
  }
}

const PAGE_PAUSE_MS =
  process.env.VITEST || process.env.NODE_ENV === "test" ? 0 : 120;

/** Stable id — no page index (breaks idempotent re-sync). */
export function okxEventId(row: OkxEarnRow): string {
  const product = row.productId ?? row.type ?? "earn";
  return `okx:${row.ts}:${row.ccy}:${product}:${row.amt}`;
}

export function normalizeOkxEarn(payload: OkxEarnResponse): EarnEvent[] {
  if (payload.code !== "0") {
    throw new OkxAdapterError(
      formatOkxApiError(payload.code, payload.msg),
      payload.code,
    );
  }
  const rows = payload.data ?? [];
  return rows.map((row) => {
    if (!row.ccy || row.amt == null || !row.ts) {
      throw new OkxAdapterError("Malformed OKX earn row");
    }
    return {
      id: okxEventId(row),
      source: "okx" as const,
      asset: row.ccy,
      amount: String(row.amt),
      earnedAt: new Date(Number(row.ts)).toISOString(),
      rawType: row.type ?? "SAVINGS_INTEREST",
      meta: { productId: row.productId },
    };
  });
}

function formatOkxApiError(code: string, msg?: string): string {
  const base = msg || `OKX error code ${code}`;
  if (code === "50119") {
    return `${base} — API key not found; re-save OKX key, secret, and passphrase in Connect sources`;
  }
  if (code === "50111" || code === "50113") {
    return `${base} — check OKX secret/passphrase (re-save credentials if unsure)`;
  }
  return base;
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

function isRetryableHttp(status: number): boolean {
  return status === 429 || status >= 500;
}

async function okxGet(
  path: string,
  query: Record<string, string>,
  creds: CexCredentials,
): Promise<OkxEarnResponse> {
  // Stable key order for signature — OKX signs the exact request path+query.
  const qs = Object.keys(query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
    .join("&");
  const pathWithQuery = qs ? `${path}?${qs}` : path;
  const maxAttempts = 4;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let status = 0;
    let bodyText = "";

    if (creds.accessToken) {
      const res = await fetch(`${OKX_BASE}${pathWithQuery}`, {
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          "Content-Type": "application/json",
        },
      });
      status = res.status;
      if (res.ok) {
        return res.json() as Promise<OkxEarnResponse>;
      }
      bodyText = await readBody(res);
    } else {
      if (!creds.apiKey || !creds.apiSecret || !creds.passphrase) {
        throw new OkxAdapterError(
          "Missing OKX credentials (key/secret/passphrase)",
        );
      }

      const timestamp = new Date().toISOString();
      const sign = signOkx(timestamp, "GET", pathWithQuery, "", creds.apiSecret);
      const headers: Record<string, string> = {
        "OK-ACCESS-KEY": creds.apiKey,
        "OK-ACCESS-SIGN": sign,
        "OK-ACCESS-TIMESTAMP": timestamp,
        "OK-ACCESS-PASSPHRASE": creds.passphrase,
        "Content-Type": "application/json",
      };
      // Demo/paper trading keys need this header.
      if (process.env.OKX_SIMULATED_TRADING === "1") {
        headers["x-simulated-trading"] = "1";
      }

      const res = await fetch(`${OKX_BASE}${pathWithQuery}`, {
        headers,
      });
      status = res.status;
      if (res.ok) {
        return res.json() as Promise<OkxEarnResponse>;
      }
      bodyText = await readBody(res);
    }

    if (isRetryableHttp(status) && attempt < maxAttempts - 1) {
      const unit =
        process.env.VITEST || process.env.NODE_ENV === "test" ? 0 : 1000;
      const backoff = unit * 2 ** attempt;
      if (backoff > 0) await sleep(backoff);
      continue;
    }

    // Surface JSON body codes (e.g. 50119) when HTTP is non-2xx.
    try {
      const parsed = JSON.parse(bodyText) as OkxEarnResponse;
      if (parsed?.code && parsed.code !== "0") {
        throw new OkxAdapterError(
          formatOkxApiError(parsed.code, parsed.msg),
          parsed.code,
        );
      }
    } catch (err) {
      if (err instanceof OkxAdapterError) throw err;
    }

    if (creds.accessToken) {
      throw new OkxAdapterError(
        `OKX OAuth HTTP ${status}`,
        String(status),
      );
    }
    throw new OkxAdapterError(
      `OKX HTTP ${status}: ${bodyText.slice(0, 200)}`,
      String(status),
    );
  }

  throw new OkxAdapterError("OKX request failed after retries");
}

/**
 * Fetch OKX savings / earn interest history.
 * Optional startMs/endMs filters results; pagination stops once past startMs.
 * Throws on API/auth failure — callers must fail closed (no fake rows).
 */
export const fetchOkxEarnEvents: FetchEarnEvents = async (
  creds,
  opts?: EarnFetchOptions,
) => {
  const events: EarnEvent[] = [];
  const seen = new Set<string>();
  let after: string | undefined;
  const endMs = opts?.endMs ?? null;
  const startMs = opts?.startMs ?? null;

  // Seed cursor: OKX `after` returns records earlier than ts (older pages).
  // Start just after endMs so the first page is within the window.
  if (endMs != null) {
    after = String(endMs + 1);
  }

  for (let page = 0; page < 50; page += 1) {
    if (page > 0) await sleep(PAGE_PAUSE_MS);

    const query: Record<string, string> = { limit: "100" };
    if (after) query.after = after;

    const raw = await okxGet(
      "/api/v5/finance/savings/lending-history",
      query,
      creds,
    );
    const batch = normalizeOkxEarn(raw);
    if (batch.length === 0) break;

    let hitOlderThanStart = false;
    for (const e of batch) {
      const t = Date.parse(e.earnedAt);
      if (endMs != null && t > endMs) continue;
      if (startMs != null && t < startMs) {
        hitOlderThanStart = true;
        continue;
      }
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      events.push(e);
    }

    if (hitOlderThanStart && startMs != null) break;

    const lastTs = raw.data?.[raw.data.length - 1]?.ts;
    if (!lastTs || batch.length < 100) break;
    // Advance cursor; guard against stuck pagination on identical last ts.
    if (after === lastTs) break;
    after = lastTs;
  }

  return events;
};
