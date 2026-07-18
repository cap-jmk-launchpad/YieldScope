import { createHmac } from "node:crypto";
import type {
  CexCredentials,
  EarnEvent,
  EarnFetchOptions,
  FetchEarnEvents,
} from "./types";
import {
  ALL_TIME_LOOKBACK_MS,
  BINANCE_MAX_WINDOW_MS,
  allTimeBinanceChunks,
  chunkTimeRange,
} from "../sync-range";

const BINANCE_BASE = process.env.BINANCE_API_BASE ?? "https://api.binance.com";

/** Mandatory on /rewardsRecord — ALL returns BONUS + REALTIME + REWARDS. */
const REWARDS_TYPE = "ALL";

/** Pause between chunk requests (endpoint weight is 150). Skip in tests. */
const CHUNK_PAUSE_MS =
  process.env.VITEST || process.env.NODE_ENV === "test" ? 0 : 250;

export interface BinanceRewardRow {
  asset: string;
  rewards: string;
  time: number;
  type?: string;
  projectId?: string;
}

export interface BinanceRewardsResponse {
  rows?: BinanceRewardRow[];
  total?: number;
}

export class BinanceAdapterError extends Error {
  constructor(
    message: string,
    readonly code?: number | string,
  ) {
    super(message);
    this.name = "BinanceAdapterError";
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

/** Stable id — no page/index (those break idempotent re-sync). */
export function binanceEventId(row: BinanceRewardRow): string {
  const project = row.projectId ?? row.type ?? "reward";
  return `binance:${row.time}:${row.asset}:${project}:${row.rewards}`;
}

export function normalizeBinanceRewards(
  payload: BinanceRewardsResponse,
  _page = 0,
): EarnEvent[] {
  const rows = payload.rows ?? [];
  return rows.map((row) => {
    if (!row.asset || row.rewards == null || row.time == null) {
      throw new BinanceAdapterError("Malformed Binance reward row");
    }
    return {
      id: binanceEventId(row),
      source: "binance" as const,
      asset: row.asset,
      amount: String(row.rewards),
      earnedAt: new Date(row.time).toISOString(),
      rawType: row.type ?? "SIMPLE_EARN_REWARD",
      meta: { projectId: row.projectId },
    };
  });
}

function signQuery(query: string, secret: string): string {
  return createHmac("sha256", secret).update(query).digest("hex");
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 418 || status >= 500;
}

async function signedGet(
  path: string,
  params: Record<string, string | number>,
  creds: CexCredentials,
): Promise<unknown> {
  const maxAttempts = 4;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let status = 0;
    let body = "";

    if (creds.accessToken) {
      const qs = new URLSearchParams(
        Object.entries(params).map(([k, v]) => [k, String(v)]),
      ).toString();
      const res = await fetch(`${BINANCE_BASE}${path}?${qs}`, {
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          "Content-Type": "application/json",
        },
      });
      status = res.status;
      if (res.ok) return res.json();
      body = await readBody(res);
    } else {
      if (!creds.apiKey || !creds.apiSecret) {
        throw new BinanceAdapterError("Missing Binance credentials");
      }

      const timestamp = Date.now();
      const merged = { ...params, timestamp };
      const qs = Object.entries(merged)
        .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
        .join("&");
      const signature = signQuery(qs, creds.apiSecret);
      const res = await fetch(
        `${BINANCE_BASE}${path}?${qs}&signature=${signature}`,
        {
          headers: {
            "X-MBX-APIKEY": creds.apiKey,
          },
        },
      );
      status = res.status;
      if (res.ok) return res.json();
      body = await readBody(res);
    }

    if (isRetryableStatus(status) && attempt < maxAttempts - 1) {
      const unit =
        process.env.VITEST || process.env.NODE_ENV === "test" ? 0 : 1000;
      const backoff = unit * 2 ** attempt;
      if (backoff > 0) await sleep(backoff);
      continue;
    }

    if (creds.accessToken) {
      throw new BinanceAdapterError(
        `Binance OAuth HTTP ${status}`,
        status,
      );
    }
    throw new BinanceAdapterError(
      `Binance HTTP ${status}: ${body.slice(0, 200)}`,
      status,
    );
  }

  throw new BinanceAdapterError("Binance request failed after retries");
}

async function fetchWindow(
  creds: CexCredentials,
  startMs: number,
  endMs: number,
): Promise<EarnEvent[]> {
  const events: EarnEvent[] = [];
  let page = 1;
  const size = 100;

  for (;;) {
    const raw = (await signedGet(
      "/sapi/v1/simple-earn/flexible/history/rewardsRecord",
      {
        type: REWARDS_TYPE,
        current: page,
        size,
        startTime: startMs,
        endTime: endMs,
      },
      creds,
    )) as BinanceRewardsResponse;

    const batch = normalizeBinanceRewards(raw, page);
    events.push(...batch);

    const total = raw.total ?? batch.length;
    if (batch.length === 0 || events.length >= total || batch.length < size) {
      break;
    }
    page += 1;
    if (page > 50) break;
  }

  return events;
}

function resolveChunks(opts?: EarnFetchOptions): Array<{
  startMs: number;
  endMs: number;
}> {
  const now = Date.now();

  // Explicit all-time: walk full lookback in ≤30-day windows (no early stop —
  // gaps of empty months must not truncate older history).
  if (opts?.allTime) {
    return allTimeBinanceChunks(now);
  }

  // Custom / incremental range bounds — walk every chunk in the window.
  if (opts?.startMs != null || opts?.endMs != null) {
    const endMs = opts.endMs ?? now;
    const startMs = opts.startMs ?? endMs - ALL_TIME_LOOKBACK_MS;
    return chunkTimeRange(startMs, endMs);
  }

  // No opts (legacy / unit tests): single ≤30-day window ending now.
  return [{ startMs: now - BINANCE_MAX_WINDOW_MS + 1, endMs: now }];
}

/**
 * Fetch Binance Simple Earn flexible reward history.
 * Requires mandatory `type=ALL`. Date range via startMs/endMs; allTime walks
 * ≤30-day chunks (API max window). Throws on API/auth failure (fail closed).
 */
export const fetchBinanceEarnEvents: FetchEarnEvents = async (
  creds,
  opts?: EarnFetchOptions,
) => {
  const chunks = resolveChunks(opts);
  const seen = new Set<string>();
  const events: EarnEvent[] = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const { startMs, endMs } = chunks[i];
    if (i > 0) await sleep(CHUNK_PAUSE_MS);

    const batch = await fetchWindow(creds, startMs, endMs);
    for (const e of batch) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      events.push(e);
    }
  }

  return events;
};
