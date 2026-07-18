import { isZeroDecimal, scaleDownDecimal } from "../decimal-amount";
import { ALL_TIME_LOOKBACK_MS, CEX_TRANSPORT_MAX_SPAN_MS } from "../sync-range";
import type { EarnEvent, EarnFetchOptions } from "./types";

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

/** Minimal LCD tx shape used for withdraw-reward normalization. */
export interface LuncTxResponse {
  txhash?: string;
  height?: string | number;
  code?: number | string;
  timestamp?: string;
  events?: Array<{
    type?: string;
    attributes?: Array<{ key?: string; value?: string }>;
  }>;
  tx?: {
    body?: {
      messages?: Array<{ "@type"?: string; [k: string]: unknown }>;
    };
  };
}

export interface LuncTxSearchResponse {
  txs?: unknown[];
  tx_responses?: LuncTxResponse[];
  total?: string | number;
  pagination?: { next_key?: string | null; total?: string } | null;
}

const TERRA_ADDR_RE = /terra1[0-9a-z]{38,58}/i;
const DEFAULT_LCD =
  process.env.LUNC_LCD_URL ?? "https://terra-classic-lcd.publicnode.com";
/** Fallback LCD when the primary fails hard on tx search. */
const FALLBACK_LCDS = (
  process.env.LUNC_LCD_FALLBACKS ??
  "https://api-lunc-lcd.binodes.com,https://terra-classic-lcd.publicnode.com"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** Terra Classic tends toward ~6s blocks; used only for height window hints. */
const BLOCK_TIME_MS = Number(process.env.LUNC_BLOCK_TIME_MS ?? 6000);
const PAGE_LIMIT = 100;
const PAGE_PAUSE_MS = () =>
  Number(process.env.LUNC_TX_PAGE_PAUSE_MS ?? 250);
const HEIGHT_SLACK_BLOCKS = 2_000; // ~3h slack so boundary txs are not missed
const MAX_PAGES = 200;

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((r) => setTimeout(r, ms));
}

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
 * Parse Cosmos coin-list strings from events, e.g.
 * `131728628uluna,418681uusd` → [{denom, amount}, …].
 * Empty / whitespace → []. Fail closed on malformed tokens.
 */
export function parseCoinList(raw: string): LuncRewardCoin[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const out: LuncRewardCoin[] = [];
  for (const part of trimmed.split(",")) {
    const token = part.trim();
    if (!token) continue;
    const m = token.match(/^(\d+(?:\.\d+)?)([a-zA-Z][a-zA-Z0-9/]*)$/);
    if (!m) {
      throw new LuncAdapterError(
        `Malformed coin token in withdraw event: ${token}`,
        "bad_amount",
      );
    }
    out.push({ amount: m[1], denom: m[2] });
  }
  return out;
}

function coinToPendingEvent(
  address: string,
  coin: LuncRewardCoin,
  earnedAt: string,
  opts: { validator?: string; idSuffix: string; rawType: string },
): EarnEvent | null {
  if (!coin?.denom || coin.amount === undefined || coin.amount === null) {
    throw new LuncAdapterError("Reward coin missing denom/amount", "malformed");
  }
  const micro = String(coin.amount);
  if (isZeroDecimal(micro)) return null;
  let amount: string;
  try {
    amount = microToHuman(micro);
  } catch {
    throw new LuncAdapterError(`Bad amount ${coin.amount}`, "bad_amount");
  }
  return {
    id: `lunc_stake:${address}:${opts.idSuffix}:${coin.denom}`,
    source: "lunc_stake",
    asset: denomToAsset(coin.denom),
    amount,
    earnedAt,
    rawType: opts.rawType,
    meta: {
      ...(opts.validator ? { validator: opts.validator } : {}),
      denom: coin.denom,
      microAmount: coin.amount,
      address,
      kind: "pending",
    },
  };
}

/**
 * Pure boundary: LCD rewards payload → EarnEvent[].
 *
 * Prefers `total` (one row per denom) when present — matches LCD aggregates
 * and avoids exploding into validator×denom dust rows. Falls back to
 * per-validator rows when totals are empty.
 *
 * These rows are a **current pending snapshot** (not historical claims).
 */
export function normalizeLuncRewards(
  address: string,
  payload: LuncDelegatorRewardsResponse,
  asOf = new Date(),
): EarnEvent[] {
  if (!payload || typeof payload !== "object") {
    throw new LuncAdapterError("Malformed LCD rewards response", "malformed");
  }
  const earnedAt = asOf.toISOString();
  const events: EarnEvent[] = [];

  const totals = payload.total ?? [];
  if (totals.length > 0) {
    for (const coin of totals) {
      const ev = coinToPendingEvent(address, coin, earnedAt, {
        // Stable ids so pending upserts replace prior snapshots.
        idSuffix: "total",
        rawType: "pending_total_reward",
      });
      if (ev) events.push(ev);
    }
    if (events.length > 0) return events;
  }

  for (const entry of payload.rewards ?? []) {
    if (!entry?.validator_address) {
      throw new LuncAdapterError("Reward row missing validator_address", "malformed");
    }
    for (const coin of entry.reward ?? []) {
      const ev = coinToPendingEvent(address, coin, earnedAt, {
        validator: entry.validator_address,
        idSuffix: entry.validator_address,
        rawType: "pending_delegation_reward",
      });
      if (ev) events.push(ev);
    }
  }

  return events;
}

function txSucceeded(tx: LuncTxResponse): boolean {
  if (tx.code === undefined || tx.code === null || tx.code === "") return true;
  const n = Number(tx.code);
  return Number.isFinite(n) && n === 0;
}

function attrMap(
  attrs: Array<{ key?: string; value?: string }> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of attrs ?? []) {
    if (!a?.key) continue;
    out[a.key] = a.value ?? "";
  }
  return out;
}

/**
 * Normalize a single LCD tx into claimed-reward EarnEvents.
 * Reads `withdraw_rewards` events (works for direct MsgWithdrawDelegatorReward
 * and Authz MsgExec wrappers). Amounts come only from chain event attributes.
 */
export function normalizeWithdrawRewardTx(
  address: string,
  tx: LuncTxResponse,
): EarnEvent[] {
  if (!tx || typeof tx !== "object") {
    throw new LuncAdapterError("Malformed LCD tx", "malformed");
  }
  if (!txSucceeded(tx)) return [];
  const txhash = tx.txhash?.trim();
  if (!txhash) {
    throw new LuncAdapterError("LCD tx missing txhash", "malformed");
  }
  const earnedAt = tx.timestamp?.trim();
  if (!earnedAt || Number.isNaN(Date.parse(earnedAt))) {
    throw new LuncAdapterError(
      `LCD tx ${txhash.slice(0, 12)}… missing timestamp`,
      "malformed",
    );
  }

  const addr = address.toLowerCase();
  const events: EarnEvent[] = [];
  let rewardIdx = 0;

  for (const ev of tx.events ?? []) {
    if (ev?.type !== "withdraw_rewards") continue;
    const attrs = attrMap(ev.attributes);
    const delegator = (attrs.delegator ?? "").toLowerCase();
    if (delegator && delegator !== addr) continue;

    const validator = attrs.validator?.trim() || "unknown";
    const msgIndex =
      attrs.msg_index?.trim() ||
      attrs.authz_msg_index?.trim() ||
      String(rewardIdx);
    rewardIdx += 1;

    let coins: LuncRewardCoin[];
    try {
      coins = parseCoinList(attrs.amount ?? "");
    } catch (err) {
      if (err instanceof LuncAdapterError) throw err;
      throw new LuncAdapterError(
        `Bad withdraw amount on ${txhash.slice(0, 12)}…`,
        "bad_amount",
      );
    }

    for (const coin of coins) {
      if (isZeroDecimal(coin.amount)) continue;
      let amount: string;
      try {
        amount = microToHuman(coin.amount);
      } catch {
        throw new LuncAdapterError(
          `Bad amount ${coin.amount} on ${txhash.slice(0, 12)}…`,
          "bad_amount",
        );
      }
      events.push({
        id: `lunc_stake:${addr}:withdraw:${txhash}:${msgIndex}:${validator}:${coin.denom}`,
        source: "lunc_stake",
        asset: denomToAsset(coin.denom),
        amount,
        earnedAt,
        rawType: "withdraw_delegator_reward",
        meta: {
          kind: "claimed",
          txhash,
          height: tx.height != null ? String(tx.height) : undefined,
          validator,
          denom: coin.denom,
          microAmount: coin.amount,
          address: addr,
          msgIndex,
        },
      });
    }
  }

  return events;
}

export function normalizeWithdrawRewardTxs(
  address: string,
  txs: LuncTxResponse[],
): EarnEvent[] {
  const out: EarnEvent[] = [];
  for (const tx of txs) {
    out.push(...normalizeWithdrawRewardTx(address, tx));
  }
  return out;
}

interface LatestBlock {
  height: number;
  timeMs: number;
}

async function fetchLatestBlock(
  lcd: string,
  fetchImpl: typeof fetch,
): Promise<LatestBlock> {
  const url = `${lcd}/cosmos/base/tendermint/v1beta1/blocks/latest`;
  const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new LuncAdapterError(
      `Terra Classic LCD HTTP ${res.status} (latest block)`,
      String(res.status),
    );
  }
  const json = (await res.json()) as {
    block?: { header?: { height?: string; time?: string } };
  };
  const height = Number(json.block?.header?.height);
  const timeMs = Date.parse(json.block?.header?.time ?? "");
  if (!Number.isFinite(height) || height < 1 || Number.isNaN(timeMs)) {
    throw new LuncAdapterError("Malformed latest block response", "malformed");
  }
  return { height, timeMs };
}

/** Estimate chain height at `targetMs` from latest block + avg block time. */
export function estimateHeightAt(
  targetMs: number,
  latest: LatestBlock,
  blockTimeMs = BLOCK_TIME_MS,
): number {
  if (!Number.isFinite(targetMs) || !Number.isFinite(blockTimeMs) || blockTimeMs <= 0) {
    throw new LuncAdapterError("Bad height estimate inputs", "bad_range");
  }
  if (targetMs >= latest.timeMs) return latest.height;
  const deltaBlocks = Math.ceil((latest.timeMs - targetMs) / blockTimeMs);
  return Math.max(1, latest.height - deltaBlocks);
}

function resolveFetchWindow(
  opts?: EarnFetchOptions,
  nowMs = Date.now(),
): { startMs: number; endMs: number } {
  if (opts?.allTime) {
    return { startMs: nowMs - ALL_TIME_LOOKBACK_MS, endMs: nowMs };
  }
  if (opts?.startMs != null || opts?.endMs != null) {
    const endMs = opts.endMs ?? nowMs;
    const startMs = opts.startMs ?? endMs - ALL_TIME_LOOKBACK_MS;
    if (startMs > endMs) {
      throw new LuncAdapterError("LUNC sync range from must be on or before to", "bad_range");
    }
    return { startMs, endMs };
  }
  // Default: last 90 days of claims (matches transport span).
  return { startMs: nowMs - CEX_TRANSPORT_MAX_SPAN_MS, endMs: nowMs };
}

function shouldIncludePending(
  endMs: number,
  nowMs: number,
  explicit?: boolean,
): boolean {
  if (explicit === false) return false;
  if (explicit === true) return true;
  // Include pending when the window reaches “now” (within one day).
  return endMs >= nowMs - 24 * 60 * 60 * 1000;
}

function buildWithdrawQuery(
  address: string,
  heightMin: number,
  heightMax: number,
): string {
  return (
    `withdraw_rewards.delegator='${address}'` +
    ` AND tx.height>=${heightMin}` +
    ` AND tx.height<=${heightMax}`
  );
}

function isPageOutOfRangeMessage(body: string): boolean {
  return /page should be within/i.test(body);
}

async function fetchTxPage(
  lcd: string,
  query: string,
  page: number,
  fetchImpl: typeof fetch,
): Promise<{ txs: LuncTxResponse[]; raw: LuncTxSearchResponse }> {
  const params = new URLSearchParams();
  params.set("query", query);
  params.set("page", String(page));
  params.set("limit", String(PAGE_LIMIT));
  params.set("order_by", "ORDER_BY_DESC");
  const url = `${lcd}/cosmos/tx/v1beta1/txs?${params.toString()}`;
  const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 500 || res.status === 400) {
      if (page > 1 && isPageOutOfRangeMessage(body)) {
        return { txs: [], raw: { tx_responses: [] } };
      }
    }
    // Some nodes return 500 with the page-range message.
    if (isPageOutOfRangeMessage(body)) {
      return { txs: [], raw: { tx_responses: [] } };
    }
    throw new LuncAdapterError(
      `Terra Classic LCD HTTP ${res.status} (tx search)`,
      String(res.status),
    );
  }
  const raw = (await res.json()) as LuncTxSearchResponse;
  if (!raw || typeof raw !== "object") {
    throw new LuncAdapterError("Malformed LCD tx search response", "malformed");
  }
  return { txs: raw.tx_responses ?? [], raw };
}

/**
 * Paginated crawl of withdraw-reward txs for one height window.
 * Dedupes by txhash; stops on empty / no-new / page-out-of-range.
 */
export async function crawlWithdrawRewardTxs(
  address: string,
  opts: {
    lcdUrl: string;
    heightMin: number;
    heightMax: number;
    fetchImpl?: typeof fetch;
    startMs?: number;
    endMs?: number;
  },
): Promise<LuncTxResponse[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const query = buildWithdrawQuery(address, opts.heightMin, opts.heightMax);
  const seen = new Set<string>();
  const collected: LuncTxResponse[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    if (page > 1) await sleep(PAGE_PAUSE_MS());
    const { txs } = await fetchTxPage(opts.lcdUrl, query, page, fetchImpl);
    if (txs.length === 0) break;

    let newCount = 0;
    let oldestMs = Number.POSITIVE_INFINITY;
    for (const tx of txs) {
      const hash = tx.txhash?.trim();
      if (!hash || seen.has(hash)) continue;
      seen.add(hash);
      newCount += 1;

      const t = Date.parse(tx.timestamp ?? "");
      if (Number.isFinite(t) && t < oldestMs) oldestMs = t;

      if (opts.startMs != null && Number.isFinite(t) && t < opts.startMs) {
        // Still collect for completeness of this page; caller filters.
      }
      if (opts.endMs != null && Number.isFinite(t) && t > opts.endMs) {
        // Skip future-of-window later via filter.
      }
      collected.push(tx);
    }

    if (newCount === 0) break;

    // DESC order: once the whole page is older than startMs, further pages are older.
    if (
      opts.startMs != null &&
      Number.isFinite(oldestMs) &&
      oldestMs < opts.startMs &&
      txs.every((tx) => {
        const t = Date.parse(tx.timestamp ?? "");
        return Number.isFinite(t) && t < opts.startMs!;
      })
    ) {
      break;
    }
  }

  return collected;
}

async function fetchPendingRewards(
  address: string,
  lcd: string,
  fetchImpl: typeof fetch,
  asOf: Date,
): Promise<EarnEvent[]> {
  const url = `${lcd}/cosmos/distribution/v1beta1/delegators/${address}/rewards`;
  const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new LuncAdapterError(
      `Terra Classic LCD HTTP ${res.status}`,
      String(res.status),
    );
  }
  const json = (await res.json()) as LuncDelegatorRewardsResponse;
  return normalizeLuncRewards(address, json, asOf);
}

function lcdCandidates(primary: string): string[] {
  const list = [primary, ...FALLBACK_LCDS.map((s) => s.replace(/\/$/, ""))];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const lcd of list) {
    const n = lcd.replace(/\/$/, "");
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/**
 * Split [startMs, endMs] into ≤90-day crawl windows (newest first) so each
 * height-bounded LCD search stays small and edge timeouts stay unlikely.
 */
export function luncHistoryChunks(
  startMs: number,
  endMs: number,
  maxSpanMs = CEX_TRANSPORT_MAX_SPAN_MS,
): Array<{ startMs: number; endMs: number }> {
  if (startMs > endMs) return [];
  const chunks: Array<{ startMs: number; endMs: number }> = [];
  let end = endMs;
  while (end >= startMs) {
    const start = Math.max(startMs, end - maxSpanMs + 1);
    chunks.push({ startMs: start, endMs: end });
    if (start <= startMs) break;
    end = start - 1;
  }
  return chunks;
}

export interface FetchLuncStakeOptions extends EarnFetchOptions {
  lcdUrl?: string;
  fetchImpl?: typeof fetch;
  /** Override pending inclusion (default: when window reaches “now”). */
  includePending?: boolean;
  /** Injected clock for tests. */
  nowMs?: number;
  /** Injected latest block for tests (skips /blocks/latest). */
  latestBlock?: LatestBlock;
}

/**
 * Fetch LUNC stake earn events:
 * 1. Historical **claimed** rewards from chain txs (`withdraw_rewards` events)
 *    inside the sync window (paginated LCD tx search).
 * 2. Optional **current pending** snapshot from distribution LCD (separate
 *    rawTypes / ids — never mixed into claimed amounts).
 *
 * Fail closed on HTTP / malformed payloads. Does not invent amounts.
 */
export async function fetchLuncStakeEarnEvents(
  addressOrLink: string,
  opts?: FetchLuncStakeOptions,
): Promise<EarnEvent[]> {
  const address = parseLuncAddress(addressOrLink);
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const nowMs = opts?.nowMs ?? Date.now();
  const window = resolveFetchWindow(opts, nowMs);
  const primary = (opts?.lcdUrl ?? DEFAULT_LCD).replace(/\/$/, "");
  const lcds = lcdCandidates(primary);

  let lastErr: unknown;
  let history: EarnEvent[] = [];
  let usedLcd = primary;

  for (const lcd of lcds) {
    try {
      const latest =
        opts?.latestBlock ?? (await fetchLatestBlock(lcd, fetchImpl));
      const chunks = luncHistoryChunks(window.startMs, window.endMs);
      const seenIds = new Set<string>();
      const events: EarnEvent[] = [];

      for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i];
        if (i > 0) await sleep(PAGE_PAUSE_MS());

        const rawMin = estimateHeightAt(chunk.startMs, latest);
        const rawMax = estimateHeightAt(chunk.endMs, latest);
        const heightMin = Math.max(1, Math.min(rawMin, rawMax) - HEIGHT_SLACK_BLOCKS);
        const heightMax = Math.max(rawMin, rawMax) + HEIGHT_SLACK_BLOCKS;

        const txs = await crawlWithdrawRewardTxs(address, {
          lcdUrl: lcd,
          heightMin,
          heightMax,
          fetchImpl,
          startMs: chunk.startMs,
          endMs: chunk.endMs,
        });

        for (const ev of normalizeWithdrawRewardTxs(address, txs)) {
          const t = Date.parse(ev.earnedAt);
          if (t < chunk.startMs || t > chunk.endMs) continue;
          if (t < window.startMs || t > window.endMs) continue;
          if (seenIds.has(ev.id)) continue;
          seenIds.add(ev.id);
          events.push(ev);
        }
      }

      history = events;
      usedLcd = lcd;
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      // Try next LCD only on hard transport / HTTP failures.
      if (!(err instanceof LuncAdapterError)) throw err;
      if (err.code === "malformed" || err.code === "bad_amount" || err.code === "bad_range") {
        throw err;
      }
    }
  }

  if (lastErr) throw lastErr;

  const out = [...history];

  if (shouldIncludePending(window.endMs, nowMs, opts?.includePending)) {
    const pending = await fetchPendingRewards(
      address,
      usedLcd,
      fetchImpl,
      new Date(nowMs),
    );
    const seen = new Set(out.map((e) => e.id));
    for (const ev of pending) {
      if (seen.has(ev.id)) continue;
      out.push(ev);
    }
  }

  return out;
}
