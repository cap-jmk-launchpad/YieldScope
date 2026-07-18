/** Shared earn-event shape across Binance, OKX, Monad, and LUNC staking adapters. */

export type SourceId = "binance" | "okx" | "monad_stake" | "lunc_stake";

export type SourceStatus = "ok" | "error" | "not_connected";

export interface EarnEvent {
  id: string;
  source: SourceId;
  asset: string;
  amount: string;
  /** ISO-8601 */
  earnedAt: string;
  rawType?: string;
  meta?: Record<string, unknown>;
}

export interface AdapterResult {
  status: SourceStatus;
  events: EarnEvent[];
  error?: string;
}

export interface CexCredentials {
  apiKey: string;
  apiSecret: string;
  /** OKX passphrase when required */
  passphrase?: string;
  /** Optional OAuth access token — preferred when present */
  accessToken?: string;
}

export interface EarnFetchOptions {
  /** Inclusive start (ms epoch). Omit with endMs for all-time / adapter default. */
  startMs?: number | null;
  /** Inclusive end (ms epoch). */
  endMs?: number | null;
  /** When true, paginate the full available history (CEX). */
  allTime?: boolean;
}

export type FetchEarnEvents = (
  creds: CexCredentials,
  opts?: EarnFetchOptions,
) => Promise<EarnEvent[]>;
