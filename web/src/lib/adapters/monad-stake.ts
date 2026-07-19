import {
  type Address,
  type Hex,
  decodeAbiParameters,
  encodeFunctionData,
  parseAbi,
} from "viem";
import { formatBaseUnits } from "../decimal-amount";
import type { EarnEvent } from "./types";

/** Monad staking precompile — docs.monad.xyz */
export const MONAD_STAKING_PRECOMPILE =
  "0x0000000000000000000000000000000000001000" as const;

/**
 * Official staking ABI (docs.monad.xyz/reference/staking/api).
 * getDelegations returns (isDone, nextValId, valIds) — NOT (isDone, valIds, nextValId).
 * The wrong order silently decodes empty/non-empty pages as fake validatorId 0.
 *
 * Reward rule (product): only unclaimed rewards from validators returned by
 * getDelegations for this wallet count. That set is the current (and residual)
 * delegation list — not arbitrary wallet transfers, not validators never
 * delegated to. Historical ClaimRewards logs are not indexed (public RPC
 * eth_getLogs capped at 100 blocks), so pending unclaimed is the honest snapshot.
 */
export const monadStakingAbi = parseAbi([
  "function getDelegator(uint64 validatorId, address delegator) returns (uint256 stake, uint256 accRewardPerToken, uint256 unclaimedRewards, uint256 deltaStake, uint256 nextDeltaStake, uint64 deltaEpoch, uint64 nextDeltaEpoch)",
  "function getDelegations(address delegator, uint64 startValId) returns (bool isDone, uint64 nextValId, uint64[] valIds)",
]);

export interface DelegatorState {
  validatorId: bigint;
  stake: bigint;
  accRewardPerToken: bigint;
  unclaimedRewards: bigint;
  deltaStake: bigint;
  nextDeltaStake: bigint;
  deltaEpoch: bigint;
  nextDeltaEpoch: bigint;
}

export class MonadStakeAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MonadStakeAdapterError";
  }
}

/** Validator ids are 1-based; drop 0 and duplicates (wrong-ABI / bad override symptom). */
export function normalizeDelegationValIds(ids: readonly bigint[]): bigint[] {
  const seen = new Set<string>();
  const out: bigint[] = [];
  for (const id of ids) {
    if (id <= 0n) continue;
    const key = id.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}

export function decodeGetDelegatorResult(data: Hex): Omit<
  DelegatorState,
  "validatorId"
> {
  if (!data || data === "0x") {
    throw new MonadStakeAdapterError("Empty getDelegator response");
  }
  const decoded = decodeAbiParameters(
    [
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint64" },
      { type: "uint64" },
    ],
    data,
  );
  return {
    stake: decoded[0],
    accRewardPerToken: decoded[1],
    unclaimedRewards: decoded[2],
    deltaStake: decoded[3],
    nextDeltaStake: decoded[4],
    deltaEpoch: decoded[5],
    nextDeltaEpoch: decoded[6],
  };
}

export function encodeGetDelegatorCall(
  validatorId: bigint,
  delegator: Address,
): Hex {
  return encodeFunctionData({
    abi: monadStakingAbi,
    functionName: "getDelegator",
    args: [validatorId, delegator],
  });
}

export function encodeGetDelegationsCall(
  delegator: Address,
  startValId: bigint,
): Hex {
  return encodeFunctionData({
    abi: monadStakingAbi,
    functionName: "getDelegations",
    args: [delegator, startValId],
  });
}

export function decodeGetDelegationsResult(data: Hex): {
  done: boolean;
  valIds: bigint[];
  nextValId: bigint;
} {
  if (!data || data === "0x") {
    throw new MonadStakeAdapterError("Empty getDelegations response");
  }
  // Wire order: bool isDone, uint64 nextValId, uint64[] valIds
  const decoded = decodeAbiParameters(
    [{ type: "bool" }, { type: "uint64" }, { type: "uint64[]" }],
    data,
  );
  return {
    done: decoded[0],
    nextValId: decoded[1],
    valIds: normalizeDelegationValIds([...decoded[2]]),
  };
}

/**
 * Map delegator states → earn rows.
 * Only unclaimed rewards from delegated validators become events (fail closed).
 */
export function delegatorStatesToEarnEvents(
  address: Address,
  states: DelegatorState[],
  asOf: Date = new Date(),
): EarnEvent[] {
  return states
    .filter((s) => s.validatorId > 0n && s.unclaimedRewards > 0n)
    .map((s) => ({
      id: `monad_stake:${address.toLowerCase()}:val${s.validatorId}:${asOf.toISOString()}`,
      source: "monad_stake" as const,
      asset: "MON",
      amount: formatMon(s.unclaimedRewards),
      earnedAt: asOf.toISOString(),
      rawType: "UNCLAIMED_STAKING_REWARDS",
      meta: {
        validatorId: s.validatorId.toString(),
        stake: formatMon(s.stake),
        accRewardPerToken: s.accRewardPerToken.toString(),
      },
    }));
}

function hasStakePresence(s: DelegatorState): boolean {
  return s.stake > 0n || s.deltaStake > 0n || s.nextDeltaStake > 0n;
}

/** Soft UX copy when sync succeeds with zero earn rows (not an error). */
export function monadStakeEmptyInfo(states: DelegatorState[]): string {
  const staked = states.filter(hasStakePresence);
  if (staked.length === 0) {
    return "No Monad delegation found for this wallet. Buying or holding MON does not earn staking rewards until you delegate to a validator. Unclaimed rewards from validators you’re delegated to appear here after you stake.";
  }
  const totalStake = staked.reduce((acc, s) => acc + s.stake, 0n);
  return `Wallet is delegated to ${staked.length} validator${staked.length === 1 ? "" : "s"} (${formatMon(totalStake)} MON) but has no unclaimed rewards yet. Only pending unclaimed from your current delegation set is shown — claimed reward history is not indexed on the public RPC (eth_getLogs capped at 100 blocks).`;
}

/** Exact wei → MON decimal string (18 dp). Exported for tests / shared formatting. */
export function formatMon(wei: bigint): string {
  return formatBaseUnits(wei, 18);
}

export type RpcCall = (args: {
  to: Address;
  data: Hex;
}) => Promise<Hex>;

export interface MonadStakeScanResult {
  events: EarnEvent[];
  /** Soft guidance when events is empty — never invents rows. */
  info?: string;
  states: DelegatorState[];
  /** Validator IDs from getDelegations (after normalize / optional restrict). */
  delegatedValidatorIds: bigint[];
}

export interface ScanMonadStakeOpts {
  /**
   * Optional restrict to a subset of getDelegations results.
   * Never invents IDs: non-delegated validators are dropped (fail closed).
   */
  onlyValidatorIds?: bigint[];
  /** @deprecated Use onlyValidatorIds — kept as alias for smoke/tests. */
  validatorIds?: bigint[];
  asOf?: Date;
}

/**
 * Read Monad staking rewards for an address via precompile 0x1000.
 * Fail closed: throws on RPC / decode errors; never invents rows.
 */
export async function fetchMonadStakeEarnEvents(
  address: Address,
  rpcCall: RpcCall,
  opts?: ScanMonadStakeOpts,
): Promise<EarnEvent[]> {
  const scan = await scanMonadStake(address, rpcCall, opts);
  return scan.events;
}

/**
 * Full scan including soft empty-state info for the dashboard.
 *
 * Calculation rule:
 * 1. Enumerate validators via getDelegations (paginated) — source of truth.
 * 2. Read getDelegator only for those validator IDs.
 * 3. Emit earn rows only where unclaimedRewards > 0 (pending accrued while
 *    delegated; the precompile’s unclaimed balance is the protocol’s
 *    delegation-period accrual for that (validator, delegator) pair).
 * 4. Never attribute transfers or non-delegated validators.
 */
export async function scanMonadStake(
  address: Address,
  rpcCall: RpcCall,
  opts?: ScanMonadStakeOpts,
): Promise<MonadStakeScanResult> {
  if (!address || address === "0x0000000000000000000000000000000000000000") {
    throw new MonadStakeAdapterError("Invalid delegator address");
  }

  const listed = await listDelegations(address, rpcCall);
  const restrictRaw = opts?.onlyValidatorIds ?? opts?.validatorIds;
  const restrict = restrictRaw
    ? new Set(normalizeDelegationValIds(restrictRaw).map((id) => id.toString()))
    : null;

  const validatorIds = restrict
    ? listed.filter((id) => restrict.has(id.toString()))
    : listed;

  if (validatorIds.length === 0) {
    return {
      events: [],
      info: monadStakeEmptyInfo([]),
      states: [],
      delegatedValidatorIds: [],
    };
  }

  const states: DelegatorState[] = [];
  for (const validatorId of validatorIds) {
    const data = await rpcCall({
      to: MONAD_STAKING_PRECOMPILE,
      data: encodeGetDelegatorCall(validatorId, address),
    });
    const decoded = decodeGetDelegatorResult(data);
    states.push({ validatorId, ...decoded });
  }

  const events = delegatorStatesToEarnEvents(address, states, opts?.asOf);
  return {
    events,
    info: events.length === 0 ? monadStakeEmptyInfo(states) : undefined,
    states,
    delegatedValidatorIds: validatorIds,
  };
}

/** Paginated getDelegations — only real delegated validator IDs. */
export async function listDelegations(
  address: Address,
  rpcCall: RpcCall,
): Promise<bigint[]> {
  const ids: bigint[] = [];
  let startValId = 0n;
  for (let i = 0; i < 20; i += 1) {
    const data = await rpcCall({
      to: MONAD_STAKING_PRECOMPILE,
      data: encodeGetDelegationsCall(address, startValId),
    });
    const page = decodeGetDelegationsResult(data);
    ids.push(...page.valIds);
    if (page.done || page.valIds.length === 0) break;
    startValId = page.nextValId;
  }
  return normalizeDelegationValIds(ids);
}
