import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeAbiParameters, type Hex } from "viem";
import { describe, expect, it, vi } from "vitest";
import {
  decodeGetDelegationsResult,
  decodeGetDelegatorResult,
  delegatorStatesToEarnEvents,
  encodeGetDelegatorCall,
  fetchMonadStakeEarnEvents,
  formatMon,
  listDelegations,
  monadStakeEmptyInfo,
  MonadStakeAdapterError,
  normalizeDelegationValIds,
  scanMonadStake,
  type RpcCall,
} from "../../web/src/lib/adapters/monad-stake";

const root = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/monad");
const fixture = JSON.parse(
  readFileSync(join(root, "getDelegator-sample.json"), "utf8"),
);

const ADDR = "0x1111111111111111111111111111111111111111" as const;

/** Official wire order: (bool isDone, uint64 nextValId, uint64[] valIds) */
function encodeDelegationsPage(
  done: boolean,
  nextValId: bigint,
  valIds: bigint[],
) {
  return encodeAbiParameters(
    [{ type: "bool" }, { type: "uint64" }, { type: "uint64[]" }],
    [done, nextValId, valIds],
  );
}

function encodeDelegatorState(opts: {
  stake?: bigint;
  unclaimedRewards?: bigint;
  accRewardPerToken?: bigint;
}): Hex {
  return encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint64" },
      { type: "uint64" },
    ],
    [
      opts.stake ?? 0n,
      opts.accRewardPerToken ?? 0n,
      opts.unclaimedRewards ?? 0n,
      0n,
      0n,
      0n,
      0n,
    ],
  );
}

describe("Monad staking reader", () => {
  it("decodes getDelegator fixture payload", () => {
    const decoded = decodeGetDelegatorResult(fixture.encodedGetDelegatorResult);
    expect(decoded.stake).toBe(BigInt(fixture.stake));
    expect(decoded.unclaimedRewards).toBe(BigInt(fixture.unclaimedRewards));
    expect(decoded.deltaEpoch).toBe(BigInt(fixture.deltaEpoch));
  });

  it("encodes getDelegator call data with selector", () => {
    const data = encodeGetDelegatorCall(1n, ADDR);
    expect(data.startsWith("0x573c1ce0")).toBe(true);
  });

  it("decodes getDelegations with official (isDone, nextValId, valIds) order", () => {
    const encoded = encodeDelegationsPage(true, 0n, [1n, 154n, 3n]);
    const page = decodeGetDelegationsResult(encoded);
    expect(page.done).toBe(true);
    expect(page.nextValId).toBe(0n);
    expect(page.valIds).toEqual([1n, 154n, 3n]);
  });

  it("does not invent validator 0 from empty-page ABI layout", () => {
    const empty = encodeDelegationsPage(true, 0n, []);
    const page = decodeGetDelegationsResult(empty);
    expect(page.valIds).toEqual([]);
  });

  it("filters bogus validator 0 from getDelegations pages", () => {
    const encoded = encodeDelegationsPage(true, 0n, [0n, 1n, 0n, 2n]);
    expect(decodeGetDelegationsResult(encoded).valIds).toEqual([1n, 2n]);
    expect(normalizeDelegationValIds([0n, 1n, 0n, 1n, 3n])).toEqual([1n, 3n]);
  });

  it("maps unclaimed rewards to EarnEvent", () => {
    const events = delegatorStatesToEarnEvents(
      ADDR,
      [
        {
          validatorId: 1n,
          stake: BigInt(fixture.stake),
          accRewardPerToken: BigInt(fixture.accRewardPerToken),
          unclaimedRewards: BigInt(fixture.unclaimedRewards),
          deltaStake: 0n,
          nextDeltaStake: 0n,
          deltaEpoch: 10n,
          nextDeltaEpoch: 0n,
        },
      ],
      new Date("2024-07-01T00:00:00.000Z"),
    );
    expect(events).toHaveLength(1);
    expect(events[0].source).toBe("monad_stake");
    expect(events[0].asset).toBe("MON");
    expect(events[0].amount).toBe("2.5");
  });

  it("ignores unclaimed rows with bogus validatorId 0", () => {
    const events = delegatorStatesToEarnEvents(ADDR, [
      {
        validatorId: 0n,
        stake: 1n,
        accRewardPerToken: 0n,
        unclaimedRewards: 10n ** 18n,
        deltaStake: 0n,
        nextDeltaStake: 0n,
        deltaEpoch: 0n,
        nextDeltaEpoch: 0n,
      },
    ]);
    expect(events).toEqual([]);
  });

  it("preserves 1-wei dust rewards exactly", () => {
    expect(formatMon(1n)).toBe("0.000000000000000001");
    const events = delegatorStatesToEarnEvents(
      ADDR,
      [
        {
          validatorId: 1n,
          stake: 1n,
          accRewardPerToken: 0n,
          unclaimedRewards: 1n,
          deltaStake: 0n,
          nextDeltaStake: 0n,
          deltaEpoch: 0n,
          nextDeltaEpoch: 0n,
        },
      ],
      new Date("2024-07-01T00:00:00.000Z"),
    );
    expect(events[0]!.amount).toBe("0.000000000000000001");
  });

  it("returns empty when no unclaimed rewards (even if staked)", () => {
    const states = [
      {
        validatorId: 1n,
        stake: 10n ** 18n,
        accRewardPerToken: 0n,
        unclaimedRewards: 0n,
        deltaStake: 0n,
        nextDeltaStake: 0n,
        deltaEpoch: 0n,
        nextDeltaEpoch: 0n,
      },
    ];
    expect(delegatorStatesToEarnEvents(ADDR, states)).toEqual([]);
    expect(monadStakeEmptyInfo(states)).toMatch(/no unclaimed rewards/i);
    expect(monadStakeEmptyInfo(states)).toMatch(/delegated to/i);
  });

  it("explains bought-MON-but-not-staked", () => {
    expect(monadStakeEmptyInfo([])).toMatch(/Buying or holding MON/i);
    expect(monadStakeEmptyInfo([])).toMatch(/validators you’re delegated to/i);
  });

  it("fetchMonadStakeEarnEvents uses getDelegations then getDelegator", async () => {
    const delegations = encodeDelegationsPage(true, 0n, [1n]);
    let calls = 0;
    const rpc = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return delegations;
      return fixture.encodedGetDelegatorResult as Hex;
    });
    const events = await fetchMonadStakeEarnEvents(ADDR, rpc, {
      asOf: new Date("2024-07-01T00:00:00.000Z"),
      skipClaimHistory: true,
    });
    expect(events).toHaveLength(1);
    expect(events[0].amount).toBe("2.5");
    expect(rpc).toHaveBeenCalledTimes(2);

    await expect(
      fetchMonadStakeEarnEvents(ADDR, async () => "0x" as Hex),
    ).rejects.toBeInstanceOf(MonadStakeAdapterError);
  });

  it("rejects zero address", async () => {
    await expect(
      fetchMonadStakeEarnEvents(
        "0x0000000000000000000000000000000000000000",
        async () => encodeDelegationsPage(true, 0n, [1n]),
      ),
    ).rejects.toThrow(/Invalid delegator/);
  });

  it("returns empty when not staked (no delegations)", async () => {
    const empty = encodeDelegationsPage(true, 0n, []);
    const scan = await scanMonadStake(ADDR, async () => empty, {
      skipClaimHistory: true,
    });
    expect(scan.events).toEqual([]);
    expect(scan.delegatedValidatorIds).toEqual([]);
    expect(scan.info).toMatch(/No Monad delegation found/i);
  });

  it("attributes rewards across multi-validator delegations", async () => {
    const page = encodeDelegationsPage(true, 0n, [1n, 7n, 154n]);
    const byVal: Record<string, Hex> = {
      "1": encodeDelegatorState({
        stake: 10n ** 18n,
        unclaimedRewards: 10n ** 18n,
      }),
      "7": encodeDelegatorState({
        stake: 2n * 10n ** 18n,
        unclaimedRewards: 5n * 10n ** 17n,
      }),
      "154": encodeDelegatorState({
        stake: 10n ** 18n,
        unclaimedRewards: 0n,
      }),
    };
    let phase: "list" | "rewards" = "list";
    let rewardIdx = 0;
    const order = [1n, 7n, 154n];
    const rpc: RpcCall = async () => {
      if (phase === "list") {
        phase = "rewards";
        return page;
      }
      const id = order[rewardIdx]!;
      rewardIdx += 1;
      return byVal[id.toString()]!;
    };
    const scan = await scanMonadStake(ADDR, rpc, {
      asOf: new Date("2024-07-01T00:00:00.000Z"),
      skipClaimHistory: true,
    });
    expect(scan.delegatedValidatorIds).toEqual([1n, 7n, 154n]);
    expect(scan.events).toHaveLength(2);
    expect(scan.events.map((e) => e.meta?.validatorId).sort()).toEqual([
      "1",
      "7",
    ]);
    expect(scan.events.find((e) => e.meta?.validatorId === "1")?.amount).toBe(
      "1",
    );
    expect(scan.events.find((e) => e.meta?.validatorId === "7")?.amount).toBe(
      "0.5",
    );
  });

  it("ignores non-delegated validators even if onlyValidatorIds asks for them", async () => {
    const page = encodeDelegationsPage(true, 0n, [1n]);
    let calls = 0;
    const rpc = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return page;
      return encodeDelegatorState({
        stake: 1n,
        unclaimedRewards: 10n ** 18n,
      });
    });
    // Ask for 1 (delegated) and 999 (never delegated) — 999 must not be queried.
    const scan = await scanMonadStake(ADDR, rpc, {
      onlyValidatorIds: [1n, 999n, 0n],
      asOf: new Date("2024-07-01T00:00:00.000Z"),
      skipClaimHistory: true,
    });
    expect(scan.delegatedValidatorIds).toEqual([1n]);
    expect(scan.events).toHaveLength(1);
    expect(rpc).toHaveBeenCalledTimes(2); // list + getDelegator(1) only
  });

  it("returns zero events when restrict filters out all true delegations", async () => {
    const page = encodeDelegationsPage(true, 0n, [1n, 2n]);
    const scan = await scanMonadStake(ADDR, async () => page, {
      onlyValidatorIds: [999n],
      skipClaimHistory: true,
    });
    expect(scan.events).toEqual([]);
    expect(scan.delegatedValidatorIds).toEqual([]);
    expect(scan.states).toEqual([]);
  });

  it("listDelegations paginates and drops val 0", async () => {
    const page1 = encodeDelegationsPage(false, 2n, [0n, 1n]);
    const page2 = encodeDelegationsPage(true, 0n, [2n]);
    let n = 0;
    const ids = await listDelegations(ADDR, async () => {
      n += 1;
      return n === 1 ? page1 : page2;
    });
    expect(ids).toEqual([1n, 2n]);
  });

  it("listDelegations stops when a page returns no valIds", async () => {
    const page = encodeDelegationsPage(false, 99n, []);
    const ids = await listDelegations(ADDR, async () => page);
    expect(ids).toEqual([]);
  });

  it("throws on empty getDelegator / getDelegations payloads", () => {
    expect(() => decodeGetDelegatorResult("0x")).toThrow(/Empty getDelegator/);
    expect(() => decodeGetDelegatorResult("" as Hex)).toThrow(
      /Empty getDelegator/,
    );
    expect(() => decodeGetDelegationsResult("0x")).toThrow(
      /Empty getDelegations/,
    );
  });

  it("empty-info covers deltaStake / nextDeltaStake and plural validators", () => {
    const deltaOnly = {
      validatorId: 1n,
      stake: 0n,
      accRewardPerToken: 0n,
      unclaimedRewards: 0n,
      deltaStake: 1n,
      nextDeltaStake: 0n,
      deltaEpoch: 0n,
      nextDeltaEpoch: 0n,
    };
    const nextDeltaOnly = {
      ...deltaOnly,
      validatorId: 2n,
      deltaStake: 0n,
      nextDeltaStake: 1n,
    };
    expect(monadStakeEmptyInfo([deltaOnly, nextDeltaOnly])).toMatch(
      /2 validators/,
    );
  });

  it("scan soft-info when delegated but no unclaimed rewards", async () => {
    const page = encodeDelegationsPage(true, 0n, [1n]);
    let calls = 0;
    const scan = await scanMonadStake(ADDR, async () => {
      calls += 1;
      if (calls === 1) return page;
      return encodeDelegatorState({ stake: 10n ** 18n, unclaimedRewards: 0n });
    }, { skipClaimHistory: true });
    expect(scan.events).toEqual([]);
    expect(scan.info).toMatch(/delegated to 1 validator /i);
  });

  it("honors deprecated validatorIds restrict alias", async () => {
    const page = encodeDelegationsPage(true, 0n, [1n, 2n]);
    let calls = 0;
    const rpc = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return page;
      return encodeDelegatorState({
        stake: 1n,
        unclaimedRewards: 10n ** 18n,
      });
    });
    const scan = await scanMonadStake(ADDR, rpc, {
      validatorIds: [2n],
      asOf: new Date("2024-07-01T00:00:00.000Z"),
      skipClaimHistory: true,
    });
    expect(scan.delegatedValidatorIds).toEqual([2n]);
    expect(scan.events).toHaveLength(1);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("round-trips encode/decode with viem", () => {
    const encoded = encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint64" },
        { type: "uint64" },
      ],
      [1000n, 2n, 3n, 0n, 0n, 7n, 0n],
    );
    const decoded = decodeGetDelegatorResult(encoded);
    expect(decoded.stake).toBe(1000n);
    expect(decoded.unclaimedRewards).toBe(3n);
  });

  it("merges claimed ClaimRewards with pending and soft-degrades", async () => {
    const page = encodeDelegationsPage(true, 0n, [1n]);
    let calls = 0;
    const rpc = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return page;
      return encodeDelegatorState({
        stake: 10n ** 18n,
        unclaimedRewards: 10n ** 18n,
      });
    });
    const claimed = [
      {
        id: `monad_stake:${ADDR.toLowerCase()}:claim:0xabc:0x0`,
        source: "monad_stake" as const,
        asset: "MON",
        amount: "0.25",
        earnedAt: "2026-01-15T12:00:00.000Z",
        rawType: "CLAIMED_STAKING_REWARDS",
        meta: { validatorId: "1", kind: "claimed" },
      },
    ];
    const scan = await scanMonadStake(ADDR, rpc, {
      asOf: new Date("2024-07-01T00:00:00.000Z"),
      fetchClaimed: async () => ({
        events: claimed,
        source: "explorer" as const,
        complete: true,
      }),
    });
    expect(scan.claimHistoryOk).toBe(true);
    expect(scan.claimHistorySource).toBe("explorer");
    expect(scan.claimHistoryComplete).toBe(true);
    expect(scan.claimedEvents).toHaveLength(1);
    expect(scan.pendingEvents).toHaveLength(1);
    expect(scan.events).toHaveLength(2);
    expect(scan.pendingEvents[0]!.id).toBe(
      `monad_stake:${ADDR.toLowerCase()}:val1:unclaimed`,
    );

    const softRpc = vi.fn(async () => {
      // Always return a one-page delegation + same pending state.
      if ((softRpc.mock.calls.length - 1) % 2 === 0) return page;
      return encodeDelegatorState({
        stake: 10n ** 18n,
        unclaimedRewards: 10n ** 18n,
      });
    });
    const soft = await scanMonadStake(ADDR, softRpc, {
      asOf: new Date("2024-07-01T00:00:00.000Z"),
      fetchClaimed: async () => ({
        events: [],
        source: "none" as const,
        complete: false,
        info: "Claimed reward history unavailable.",
      }),
    });
    expect(soft.claimHistoryOk).toBe(false);
    expect(soft.claimHistorySource).toBe("none");
    expect(soft.claimHistoryComplete).toBe(false);
    expect(soft.events).toHaveLength(1);
    expect(soft.info).toMatch(/history unavailable/i);
  });
});
