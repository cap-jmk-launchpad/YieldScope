import { createHmac } from "node:crypto";
import type {
  CexCredentials,
  EarnEvent,
  EarnFetchOptions,
  FetchEarnEvents,
} from "./types";

/** Global + EEA hosts. EEA API keys return 50119 on www.okx.com (live-verified Jul 2026). */
const DEFAULT_OKX_BASES = [
  "https://eea.okx.com",
  "https://www.okx.com",
  "https://my.okx.com",
] as const;

/** Sticky base after a successful auth (avoids re-probing every page). */
let stickyOkxBase: string | null = null;

/**
 * Resolve OKX REST bases to try.
 * `OKX_API_BASE` pins to a single host (no regional fallback).
 */
export function resolveOkxApiBases(): string[] {
  const configured = process.env.OKX_API_BASE?.trim().replace(/\/$/, "");
  if (configured) return [configured];
  if (stickyOkxBase) {
    return [
      stickyOkxBase,
      ...DEFAULT_OKX_BASES.filter((b) => b !== stickyOkxBase),
    ];
  }
  return [...DEFAULT_OKX_BASES];
}

/** @internal test helper — clear sticky regional base between cases. */
export function resetOkxBaseCache(): void {
  stickyOkxBase = null;
}

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

const PAGE_PAUSE_MS = () => {
  /* c8 ignore next */
  return process.env.VITEST || process.env.NODE_ENV === "test" ? 0 : 120;
};

function retryBackoffUnitMs(): number {
  /* c8 ignore next */
  return process.env.VITEST || process.env.NODE_ENV === "test" ? 0 : 1000;
}

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

export function formatOkxApiError(code: string, msg?: string): string {
  const base = msg || `OKX error code ${code}`;
  if (code === "50119") {
    return `${base} — API key not found on this OKX region; re-save key/secret/passphrase, or set OKX_API_BASE (EEA: https://eea.okx.com)`;
  }
  if (code === "50111" || code === "50113") {
    return `${base} — check OKX secret/passphrase (re-save credentials if unsure)`;
  }
  if (code === "50101") {
    return `${base} — key environment mismatch (live vs demo); toggle OKX_SIMULATED_TRADING or use a live key`;
  }
  return base;
}

/**
 * OKX v5 prehash: timestamp + method + requestPath(+query) + body.
 * Signature is Base64(HMAC-SHA256(prehash, secret)).
 */
export function signOkxRequest(
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

function isWrongRegionCode(code: string | undefined): boolean {
  return code === "50119";
}

function parseOkxBody(bodyText: string): OkxEarnResponse | null {
  try {
    return JSON.parse(bodyText) as OkxEarnResponse;
  } catch {
    return null;
  }
}

async function okxGetOnce(
  base: string,
  pathWithQuery: string,
  creds: CexCredentials,
): Promise<{
  status: number;
  bodyText: string;
  json: OkxEarnResponse | null;
}> {
  if (creds.accessToken) {
    const res = await fetch(`${base}${pathWithQuery}`, {
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "Content-Type": "application/json",
      },
    });
    const bodyText = res.ok ? "" : await readBody(res);
    if (res.ok) {
      const json = (await res.json()) as OkxEarnResponse;
      // Default 200 — some test mocks set ok without status.
      return { status: res.status || 200, bodyText: "", json };
    }
    return { status: res.status || 0, bodyText, json: parseOkxBody(bodyText) };
  }

  if (!creds.apiKey || !creds.apiSecret || !creds.passphrase) {
    throw new OkxAdapterError(
      "Missing OKX credentials (key/secret/passphrase)",
    );
  }

  const timestamp = new Date().toISOString();
  const sign = signOkxRequest(
    timestamp,
    "GET",
    pathWithQuery,
    "",
    creds.apiSecret,
  );
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

  const res = await fetch(`${base}${pathWithQuery}`, { headers });
  if (res.ok) {
    const json = (await res.json()) as OkxEarnResponse;
    return { status: res.status || 200, bodyText: "", json };
  }
  const bodyText = await readBody(res);
  return { status: res.status || 0, bodyText, json: parseOkxBody(bodyText) };
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
  // Callers always pass at least `limit`; keep `?` join unconditional.
  const pathWithQuery = `${path}?${qs}`;
  const bases = resolveOkxApiBases();
  const maxAttempts = 4;

  let lastStatus = 0;
  let lastBody = "";
  let lastJson: OkxEarnResponse | null = null;

  for (let baseIndex = 0; baseIndex < bases.length; baseIndex += 1) {
    const base = bases[baseIndex];

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      let result: Awaited<ReturnType<typeof okxGetOnce>>;
      try {
        result = await okxGetOnce(base, pathWithQuery, creds);
      } catch (err) {
        if (err instanceof OkxAdapterError) throw err;
        // Network failure on one region — try next base.
        if (baseIndex < bases.length - 1) break;
        throw new OkxAdapterError(
          err instanceof Error ? err.message : "OKX request failed",
        );
      }

      lastStatus = result.status;
      lastBody = result.bodyText;
      lastJson = result.json;

      // Success (HTTP 2xx). Still treat regional "key doesn't exist" in body.
      if (result.json && result.status >= 200 && result.status < 300) {
        if (
          isWrongRegionCode(result.json.code) &&
          baseIndex < bases.length - 1
        ) {
          if (stickyOkxBase === base) stickyOkxBase = null;
          break; // next base
        }
        stickyOkxBase = base;
        return result.json;
      }

      if (
        isWrongRegionCode(result.json?.code) &&
        baseIndex < bases.length - 1
      ) {
        if (stickyOkxBase === base) stickyOkxBase = null;
        break; // next base
      }

      if (isRetryableHttp(result.status) && attempt < maxAttempts - 1) {
        const unit = retryBackoffUnitMs();
        const backoff = unit * 2 ** attempt;
        /* c8 ignore next */
        if (backoff > 0) await sleep(backoff);
        continue;
      }

      // Non-retryable failure on this base — stop (don't spam other regions
      // for signature/passphrase errors).
      if (result.json?.code && result.json.code !== "0") {
        throw new OkxAdapterError(
          formatOkxApiError(result.json.code, result.json.msg),
          result.json.code,
        );
      }

      if (creds.accessToken) {
        throw new OkxAdapterError(
          `OKX OAuth HTTP ${result.status}`,
          String(result.status),
        );
      }
      throw new OkxAdapterError(
        `OKX HTTP ${result.status}: ${result.bodyText.slice(0, 200)}`,
        String(result.status),
      );
    }
  }

  /* c8 ignore start — loop always returns or throws above; keep for exhaustiveness */
  if (lastJson?.code && lastJson.code !== "0") {
    throw new OkxAdapterError(
      formatOkxApiError(lastJson.code, lastJson.msg),
      lastJson.code,
    );
  }
  if (creds.accessToken) {
    throw new OkxAdapterError(
      `OKX OAuth HTTP ${lastStatus}`,
      String(lastStatus),
    );
  }
  throw new OkxAdapterError(
    `OKX HTTP ${lastStatus}: ${lastBody.slice(0, 200)}`,
    String(lastStatus),
  );
  /* c8 ignore stop */
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

  // Multi-year histories can exceed a few thousand rows; keep paging until
  // the window is exhausted (or a hard safety cap).
  const maxPages = 500;
  for (let page = 0; page < maxPages; page += 1) {
    if (page > 0) await sleep(PAGE_PAUSE_MS());

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
