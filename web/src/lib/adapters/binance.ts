import { createHmac } from "node:crypto";
import type { CexCredentials, EarnEvent, FetchEarnEvents } from "./types";

const BINANCE_BASE = process.env.BINANCE_API_BASE ?? "https://api.binance.com";

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

export function normalizeBinanceRewards(
  payload: BinanceRewardsResponse,
  page = 0,
): EarnEvent[] {
  const rows = payload.rows ?? [];
  return rows.map((row, index) => {
    if (!row.asset || row.rewards == null || row.time == null) {
      throw new BinanceAdapterError("Malformed Binance reward row");
    }
    return {
      id: `binance:${row.time}:${row.asset}:${row.projectId ?? index}:p${page}`,
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

async function signedGet(
  path: string,
  params: Record<string, string | number>,
  creds: CexCredentials,
): Promise<unknown> {
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
    if (!res.ok) {
      throw new BinanceAdapterError(
        `Binance OAuth HTTP ${res.status}`,
        res.status,
      );
    }
    return res.json();
  }

  if (!creds.apiKey || !creds.apiSecret) {
    throw new BinanceAdapterError("Missing Binance credentials");
  }

  const timestamp = Date.now();
  const merged = { ...params, timestamp };
  const qs = Object.entries(merged)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  const signature = signQuery(qs, creds.apiSecret);
  const res = await fetch(`${BINANCE_BASE}${path}?${qs}&signature=${signature}`, {
    headers: {
      "X-MBX-APIKEY": creds.apiKey,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new BinanceAdapterError(
      `Binance HTTP ${res.status}: ${body.slice(0, 200)}`,
      res.status,
    );
  }
  return res.json();
}

/**
 * Fetch Binance Simple Earn flexible reward history.
 * Pure boundary: credentials in → EarnEvent[] out. Throws on API/auth failure (fail closed).
 */
export const fetchBinanceEarnEvents: FetchEarnEvents = async (creds) => {
  const events: EarnEvent[] = [];
  let page = 1;
  const size = 100;

  for (;;) {
    const raw = (await signedGet(
      "/sapi/v1/simple-earn/flexible/history/rewardsRecord",
      { current: page, size },
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
};
