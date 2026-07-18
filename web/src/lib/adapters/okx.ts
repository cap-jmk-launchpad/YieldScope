import { createHmac } from "node:crypto";
import type {
  CexCredentials,
  EarnEvent,
  EarnFetchOptions,
  FetchEarnEvents,
} from "./types";

/**
 * Global + EEA hosts. EEA API keys return 50119 on www/openapi (live-verified Jul 2026).
 * `openapi.okx.com` is OKX's recommended Global REST host (www still works).
 */
const DEFAULT_OKX_BASES = [
  "https://eea.okx.com",
  "https://openapi.okx.com",
  "https://www.okx.com",
  "https://my.okx.com",
] as const;

/**
 * Funding-account bill types that are earn credits (not deposits/redeems).
 * @see https://www.okx.com/docs-v5/en/#rest-api-funding-asset-bills-details
 *
 * Simple Earn interest often lands here as type 126 even when
 * `/finance/savings/lending-history` returns an empty page (different
 * internal ledgers — live-class gap Jul 2026).
 */
export const OKX_EARN_ASSET_BILL_TYPES = new Set([
  "126", // INTEREST_DEPOSIT — Simple Earn / savings interest
  "99", // INVESTOR_TRANSFERRED_INTEREST_IN
  "83", // STAKING_YIELD
  "139", // ETH_2_0_EARNINGS
]);

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

export interface OkxApiResponse<T = unknown> {
  code: string;
  msg?: string;
  data?: T;
}

export type OkxEarnResponse = OkxApiResponse<OkxEarnRow[]>;

/** Funding-account bill row (`/api/v5/asset/bills` / `bills-history`). */
export interface OkxAssetBillRow {
  billId?: string;
  ccy: string;
  balChg: string;
  bal?: string;
  type: string;
  ts: string;
  notes?: string;
}

/** Trading-account bill row — Auto Earn credits populate `earnAmt`. */
export interface OkxAccountBillRow {
  billId?: string;
  ccy: string;
  ts: string;
  type?: string;
  subType?: string;
  earnAmt?: string;
  balChg?: string;
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

/**
 * Map a funding bill to an earn event. Returns null for non-earn types or
 * non-credit amounts (fail closed — never invent interest from redeems).
 */
export function assetBillToEarnEvent(row: OkxAssetBillRow): EarnEvent | null {
  if (!row.type || !OKX_EARN_ASSET_BILL_TYPES.has(String(row.type))) {
    return null;
  }
  if (!row.ccy || row.balChg == null || !row.ts) {
    throw new OkxAdapterError("Malformed OKX asset bill row");
  }
  const amt = Number(row.balChg);
  if (!Number.isFinite(amt) || amt <= 0) return null;
  const billId = row.billId ?? `${row.ts}:${row.ccy}:${row.balChg}`;
  return {
    id: `okx:bill:${billId}:${row.type}`,
    source: "okx" as const,
    asset: row.ccy,
    amount: String(row.balChg),
    earnedAt: new Date(Number(row.ts)).toISOString(),
    rawType: `ASSET_BILL_${row.type}`,
    meta: { billId: row.billId, billType: row.type, notes: row.notes },
  };
}

export function normalizeOkxAssetBills(
  payload: OkxApiResponse<OkxAssetBillRow[]>,
): EarnEvent[] {
  if (payload.code !== "0") {
    throw new OkxAdapterError(
      formatOkxApiError(payload.code, payload.msg),
      payload.code,
    );
  }
  const out: EarnEvent[] = [];
  for (const row of payload.data ?? []) {
    const e = assetBillToEarnEvent(row);
    if (e) out.push(e);
  }
  return out;
}

/**
 * Auto Earn / trading-account credits expose `earnAmt` on account bills.
 * Ignore rows without a positive earnAmt (fail closed).
 */
export function accountBillToEarnEvent(
  row: OkxAccountBillRow,
): EarnEvent | null {
  if (!row.ccy || !row.ts || row.earnAmt == null || row.earnAmt === "") {
    return null;
  }
  const amt = Number(row.earnAmt);
  if (!Number.isFinite(amt) || amt <= 0) return null;
  const billId = row.billId ?? `${row.ts}:${row.ccy}:${row.earnAmt}`;
  return {
    id: `okx:acct:${billId}`,
    source: "okx" as const,
    asset: row.ccy,
    amount: String(row.earnAmt),
    earnedAt: new Date(Number(row.ts)).toISOString(),
    rawType: "ACCOUNT_EARN",
    meta: { billId: row.billId, type: row.type, subType: row.subType },
  };
}

export function normalizeOkxAccountEarnBills(
  payload: OkxApiResponse<OkxAccountBillRow[]>,
): EarnEvent[] {
  if (payload.code !== "0") {
    throw new OkxAdapterError(
      formatOkxApiError(payload.code, payload.msg),
      payload.code,
    );
  }
  const out: EarnEvent[] = [];
  for (const row of payload.data ?? []) {
    const e = accountBillToEarnEvent(row);
    if (e) out.push(e);
  }
  return out;
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

function parseOkxBody(bodyText: string): OkxApiResponse | null {
  try {
    return JSON.parse(bodyText) as OkxApiResponse;
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
  json: OkxApiResponse | null;
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
      const json = (await res.json()) as OkxApiResponse;
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
    const json = (await res.json()) as OkxApiResponse;
    return { status: res.status || 200, bodyText: "", json };
  }
  const bodyText = await readBody(res);
  return { status: res.status || 0, bodyText, json: parseOkxBody(bodyText) };
}

async function okxGet(
  path: string,
  query: Record<string, string>,
  creds: CexCredentials,
): Promise<OkxApiResponse> {
  // Stable key order for signature — OKX signs the exact request path+query.
  const qs = Object.keys(query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
    .join("&");
  const pathWithQuery = qs ? `${path}?${qs}` : path;
  const bases = resolveOkxApiBases();
  const maxAttempts = 4;

  let lastStatus = 0;
  let lastBody = "";
  let lastJson: OkxApiResponse | null = null;

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

function inWindow(
  earnedAt: string,
  startMs: number | null,
  endMs: number | null,
): "keep" | "skip_new" | "skip_old" {
  const t = Date.parse(earnedAt);
  if (endMs != null && t > endMs) return "skip_new";
  if (startMs != null && t < startMs) return "skip_old";
  return "keep";
}

function mergeUnique(into: EarnEvent[], seen: Set<string>, batch: EarnEvent[]) {
  for (const e of batch) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    into.push(e);
  }
}

/**
 * Page Simple Earn flexible lending-history (interest / matched lending rows).
 * Optional `ccy` — some regional stacks return empty without it.
 */
async function fetchLendingHistoryPages(
  creds: CexCredentials,
  opts: { startMs: number | null; endMs: number | null; ccy?: string },
): Promise<{ events: EarnEvent[]; rawRows: number }> {
  const events: EarnEvent[] = [];
  const seen = new Set<string>();
  let after: string | undefined;
  const { endMs, startMs, ccy } = opts;

  if (endMs != null) {
    after = String(endMs + 1);
  }

  const maxPages = 500;
  let rawRows = 0;
  for (let page = 0; page < maxPages; page += 1) {
    if (page > 0) await sleep(PAGE_PAUSE_MS());

    const query: Record<string, string> = { limit: "100" };
    if (after) query.after = after;
    if (ccy) query.ccy = ccy;

    const raw = (await okxGet(
      "/api/v5/finance/savings/lending-history",
      query,
      creds,
    )) as OkxEarnResponse;
    const batch = normalizeOkxEarn(raw);
    rawRows += raw.data?.length ?? 0;
    if (batch.length === 0) break;

    let hitOlderThanStart = false;
    for (const e of batch) {
      const w = inWindow(e.earnedAt, startMs, endMs);
      if (w === "skip_new") continue;
      if (w === "skip_old") {
        hitOlderThanStart = true;
        continue;
      }
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      events.push(e);
    }

    if (hitOlderThanStart && startMs != null) break;

    const lastTs = raw.data?.[raw.data.length - 1]?.ts;
    if (!lastTs || (raw.data?.length ?? 0) < 100) break;
    if (after === lastTs) break;
    after = lastTs;
  }

  return { events, rawRows };
}

async function savingsBalanceCcys(creds: CexCredentials): Promise<string[]> {
  const raw = await okxGet("/api/v5/finance/savings/balance", {}, creds);
  if (raw.code !== "0") {
    throw new OkxAdapterError(
      formatOkxApiError(raw.code, raw.msg),
      raw.code,
    );
  }
  const rows = (raw.data ?? []) as Array<{ ccy?: string }>;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const ccy = row.ccy?.trim();
    if (!ccy || seen.has(ccy)) continue;
    seen.add(ccy);
    out.push(ccy);
  }
  return out;
}

/**
 * Page funding bills for a single earn type. `path` is `/api/v5/asset/bills`
 * (recent) or `/api/v5/asset/bills-history` (~3 months).
 * Cursor is billId via `after`.
 */
async function fetchAssetBillsForType(
  creds: CexCredentials,
  path: "/api/v5/asset/bills" | "/api/v5/asset/bills-history",
  billType: string,
  startMs: number | null,
  endMs: number | null,
): Promise<EarnEvent[]> {
  const events: EarnEvent[] = [];
  const seen = new Set<string>();
  let after: string | undefined;
  const maxPages = 100;

  for (let page = 0; page < maxPages; page += 1) {
    if (page > 0) await sleep(PAGE_PAUSE_MS());

    const query: Record<string, string> = {
      limit: "100",
      type: billType,
    };
    if (after) query.after = after;

    const raw = (await okxGet(path, query, creds)) as OkxApiResponse<
      OkxAssetBillRow[]
    >;
    const rows = raw.data ?? [];
    if (raw.code !== "0") {
      throw new OkxAdapterError(
        formatOkxApiError(raw.code, raw.msg),
        raw.code,
      );
    }
    if (rows.length === 0) break;

    let hitOlderThanStart = false;
    for (const row of rows) {
      const e = assetBillToEarnEvent(row);
      if (!e) continue;
      const w = inWindow(e.earnedAt, startMs, endMs);
      if (w === "skip_new") continue;
      if (w === "skip_old") {
        hitOlderThanStart = true;
        continue;
      }
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      events.push(e);
    }

    if (hitOlderThanStart && startMs != null) break;

    const lastId = rows[rows.length - 1]?.billId;
    if (!lastId || rows.length < 100) break;
    if (after === lastId) break;
    after = lastId;
  }

  return events;
}

async function fetchAllAssetEarnBills(
  creds: CexCredentials,
  startMs: number | null,
  endMs: number | null,
): Promise<EarnEvent[]> {
  const events: EarnEvent[] = [];
  const seen = new Set<string>();
  const paths = [
    "/api/v5/asset/bills",
    "/api/v5/asset/bills-history",
  ] as const;

  for (const billType of OKX_EARN_ASSET_BILL_TYPES) {
    for (const path of paths) {
      const batch = await fetchAssetBillsForType(
        creds,
        path,
        billType,
        startMs,
        endMs,
      );
      mergeUnique(events, seen, batch);
    }
  }
  return events;
}

/** Account bills with positive `earnAmt` (Trading Account Auto Earn). */
async function fetchAccountEarnBills(
  creds: CexCredentials,
  startMs: number | null,
  endMs: number | null,
): Promise<EarnEvent[]> {
  const events: EarnEvent[] = [];
  const seen = new Set<string>();
  const paths = [
    "/api/v5/account/bills",
    "/api/v5/account/bills-archive",
  ] as const;

  for (const path of paths) {
    let after: string | undefined;
    for (let page = 0; page < 100; page += 1) {
      if (page > 0) await sleep(PAGE_PAUSE_MS());

      const query: Record<string, string> = { limit: "100" };
      if (after) query.after = after;

      const raw = (await okxGet(path, query, creds)) as OkxApiResponse<
        OkxAccountBillRow[]
      >;
      if (raw.code !== "0") {
        throw new OkxAdapterError(
          formatOkxApiError(raw.code, raw.msg),
          raw.code,
        );
      }
      const rows = raw.data ?? [];
      if (rows.length === 0) break;

      let hitOlderThanStart = false;
      const batch = normalizeOkxAccountEarnBills(raw);
      for (const e of batch) {
        const w = inWindow(e.earnedAt, startMs, endMs);
        if (w === "skip_new") continue;
        if (w === "skip_old") {
          hitOlderThanStart = true;
          continue;
        }
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        events.push(e);
      }

      // Also scan raw rows for window stop when earnAmt rows are sparse.
      for (const row of rows) {
        const t = Number(row.ts);
        if (startMs != null && Number.isFinite(t) && t < startMs) {
          hitOlderThanStart = true;
          break;
        }
      }

      if (hitOlderThanStart && startMs != null) break;

      const lastId = rows[rows.length - 1]?.billId;
      if (!lastId || rows.length < 100) break;
      if (after === lastId) break;
      after = lastId;
    }
  }

  return events;
}

/**
 * Fetch OKX savings / earn interest history.
 *
 * Merges three fail-closed sources (deduped by id):
 * 1. `/finance/savings/lending-history` — Simple Earn flexible matched interest
 * 2. `/asset/bills` + `/asset/bills-history` — funding INTEREST_DEPOSIT etc.
 *    (covers months of earnings when lending-history returns empty pages)
 * 3. `/account/bills` + `/account/bills-archive` — rows with positive `earnAmt`
 *    (Trading Account Auto Earn)
 *
 * When unfiltered lending-history is empty, retries per currency from savings
 * balance (some regional stacks require `ccy`).
 *
 * Optional startMs/endMs filters results; pagination stops once past startMs.
 * Throws on API/auth failure — callers must fail closed (no fake rows).
 */
export const fetchOkxEarnEvents: FetchEarnEvents = async (
  creds,
  opts?: EarnFetchOptions,
) => {
  const endMs = opts?.endMs ?? null;
  const startMs = opts?.startMs ?? null;
  const events: EarnEvent[] = [];
  const seen = new Set<string>();

  const lending = await fetchLendingHistoryPages(creds, { startMs, endMs });
  mergeUnique(events, seen, lending.events);

  // Empty unfiltered history → try per-ccy (regional / product quirk).
  if (lending.rawRows === 0) {
    const ccys = await savingsBalanceCcys(creds);
    for (const ccy of ccys) {
      const per = await fetchLendingHistoryPages(creds, {
        startMs,
        endMs,
        ccy,
      });
      mergeUnique(events, seen, per.events);
    }
  }

  const assetBills = await fetchAllAssetEarnBills(creds, startMs, endMs);
  mergeUnique(events, seen, assetBills);

  const accountEarn = await fetchAccountEarnBills(creds, startMs, endMs);
  mergeUnique(events, seen, accountEarn);

  return events;
};
