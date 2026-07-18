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

export const monadStakingAbi = parseAbi([
  "function getDelegator(uint64 validatorId, address delegator) returns (uint256 stake, uint256 accRewardPerToken, uint256 unclaimedRewards, uint256 deltaStake, uint256 nextDeltaStake, uint64 deltaEpoch, uint64 nextDeltaEpoch)",
  "function getDelegations(address delegator, uint64 startValId) returns (bool done, uint64[] valIds, uint64 nextValId)",
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
  const decoded = decodeAbiParameters(
    [{ type: "bool" }, { type: "uint64[]" }, { type: "uint64" }],
    data,
  );
  return {
    done: decoded[0],
    valIds: [...decoded[1]],
    nextValId: decoded[2],
  };
}

export function delegatorStatesToEarnEvents(
  address: Address,
  states: DelegatorState[],
  asOf: Date = new Date(),
): EarnEvent[] {
  return states
    .filter((s) => s.unclaimedRewards > 0n || s.stake > 0n)
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

/** Exact wei → MON decimal string (18 dp). Exported for tests / shared formatting. */
export function formatMon(wei: bigint): string {
  return formatBaseUnits(wei, 18);
}

export type RpcCall = (args: {
  to: Address;
  data: Hex;
}) => Promise<Hex>;

/**
 * Read Monad staking rewards for an address via precompile 0x1000.
 * Fail closed: throws on RPC / decode errors; never invents rows.
 */
export async function fetchMonadStakeEarnEvents(
  address: Address,
  rpcCall: RpcCall,
  opts?: { validatorIds?: bigint[]; asOf?: Date },
): Promise<EarnEvent[]> {
  if (!address || address === "0x0000000000000000000000000000000000000000") {
    throw new MonadStakeAdapterError("Invalid delegator address");
  }

  let validatorIds = opts?.validatorIds ?? [];
  if (validatorIds.length === 0) {
    validatorIds = await listDelegations(address, rpcCall);
  }

  if (validatorIds.length === 0) {
    return [];
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

  return delegatorStatesToEarnEvents(address, states, opts?.asOf);
}

async function listDelegations(
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
  return ids;
}
