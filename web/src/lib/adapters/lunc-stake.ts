import { isZeroDecimal, scaleDownDecimal } from "../decimal-amount";
import type { EarnEvent } from "./types";

export class LuncAdapterError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "LuncAdapterError";
  }
}

export interface LuncRewardCoin {
  denom: string;
  amount: string;
}

export interface LuncValidatorReward {
  validator_address: string;
  reward: LuncRewardCoin[];
}

/** LCD `/cosmos/distribution/v1beta1/delegators/{addr}/rewards` response. */
export interface LuncDelegatorRewardsResponse {
  rewards?: LuncValidatorReward[];
  total?: LuncRewardCoin[];
}

const TERRA_ADDR_RE = /terra1[0-9a-z]{38,58}/i;
const DEFAULT_LCD =
  process.env.LUNC_LCD_URL ?? "https://terra-classic-lcd.publicnode.com";

/**
 * Extract a Terra Classic address from a raw address or explorer wallet link.
 * Supports finder.terra.money / mintscan / station-style URLs that embed terra1…
 */
export function parseLuncAddress(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new LuncAdapterError("Empty LUNC wallet address", "empty");
  }
  if (TERRA_ADDR_RE.test(trimmed) && !trimmed.includes("/")) {
    return trimmed.match(TERRA_ADDR_RE)![0].toLowerCase();
  }
  try {
    const url = new URL(trimmed);
    const fromPath = url.pathname.match(TERRA_ADDR_RE);
    if (fromPath) return fromPath[0].toLowerCase();
    const fromQuery =
      url.searchParams.get("address") ||
      url.searchParams.get("account") ||
      url.searchParams.get("addr");
    if (fromQuery && TERRA_ADDR_RE.test(fromQuery)) {
      return fromQuery.match(TERRA_ADDR_RE)![0].toLowerCase();
    }
  } catch {
    /* not a URL — fall through */
  }
  const embedded = trimmed.match(TERRA_ADDR_RE);
  if (embedded) return embedded[0].toLowerCase();
  throw new LuncAdapterError(
    "Invalid Terra Classic address — paste a terra1… address or explorer link",
    "invalid_address",
  );
}

/** Map uluna / other denoms to display assets. */
export function denomToAsset(denom: string): string {
  if (denom === "uluna") return "LUNC";
  if (denom === "uusd") return "USTC";
  if (denom.startsWith("u") && denom.length > 1) {
    return denom.slice(1).toUpperCase();
  }
  return denom.toUpperCase();
}

/**
 * Convert micro-denom amount string to human decimal string (default 6 dp).
 * Uses exact decimal-string math — no Number()/toFixed — so dust rewards survive.
 */
export function microToHuman(amount: string, decimals = 6): string {
  try {
    return scaleDownDecimal(amount, decimals);
  } catch {
    throw new LuncAdapterError(`Malformed reward amount: ${amount}`, "bad_amount");
  }
}

/**
 * Pure boundary: LCD rewards payload → EarnEvent[].
 * One event per (validator, denom) with non-zero pending rewards.
 * Fail closed on malformed payload.
 */
export function normalizeLuncRewards(
  address: string,
  payload: LuncDelegatorRewardsResponse,
  asOf = new Date(),
): EarnEvent[] {
  if (!payload || typeof payload !== "object") {
    throw new LuncAdapterError("Malformed LCD rewards response", "malformed");
  }
  const rewards = payload.rewards ?? [];
  const events: EarnEvent[] = [];
  const earnedAt = asOf.toISOString();

  for (const entry of rewards) {
    if (!entry?.validator_address) {
      throw new LuncAdapterError("Reward row missing validator_address", "malformed");
    }
    for (const coin of entry.reward ?? []) {
      if (!coin?.denom || coin.amount === undefined || coin.amount === null) {
        throw new LuncAdapterError("Reward coin missing denom/amount", "malformed");
      }
      const micro = String(coin.amount);
      if (isZeroDecimal(micro)) continue;
      let amount: string;
      try {
        amount = microToHuman(micro);
      } catch {
        throw new LuncAdapterError(`Bad amount ${coin.amount}`, "bad_amount");
      }
      const asset = denomToAsset(coin.denom);
      events.push({
        id: `lunc_stake:${address}:${entry.validator_address}:${coin.denom}`,
        source: "lunc_stake",
        asset,
        amount,
        earnedAt,
        rawType: "pending_delegation_reward",
        meta: {
          validator: entry.validator_address,
          denom: coin.denom,
          microAmount: coin.amount,
          address,
        },
      });
    }
  }

  // If per-validator empty but total present, emit totals
  if (events.length === 0 && (payload.total?.length ?? 0) > 0) {
    for (const coin of payload.total!) {
      if (!coin?.denom || coin.amount == null) {
        throw new LuncAdapterError("Total coin missing denom/amount", "malformed");
      }
      const micro = String(coin.amount);
      if (isZeroDecimal(micro)) continue;
      const amount = microToHuman(micro);
      events.push({
        id: `lunc_stake:${address}:total:${coin.denom}`,
        source: "lunc_stake",
        asset: denomToAsset(coin.denom),
        amount,
        earnedAt,
        rawType: "pending_total_reward",
        meta: { denom: coin.denom, microAmount: coin.amount, address },
      });
    }
  }

  return events;
}

export async function fetchLuncStakeEarnEvents(
  addressOrLink: string,
  opts?: { lcdUrl?: string; fetchImpl?: typeof fetch },
): Promise<EarnEvent[]> {
  const address = parseLuncAddress(addressOrLink);
  const lcd = (opts?.lcdUrl ?? DEFAULT_LCD).replace(/\/$/, "");
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const url = `${lcd}/cosmos/distribution/v1beta1/delegators/${address}/rewards`;
  const res = await fetchImpl(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new LuncAdapterError(
      `Terra Classic LCD HTTP ${res.status}`,
      String(res.status),
    );
  }
  const json = (await res.json()) as LuncDelegatorRewardsResponse;
  return normalizeLuncRewards(address, json);
}
