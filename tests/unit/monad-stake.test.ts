import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeAbiParameters } from "viem";
import { describe, expect, it, vi } from "vitest";
import {
  decodeGetDelegationsResult,
  decodeGetDelegatorResult,
  delegatorStatesToEarnEvents,
  encodeGetDelegatorCall,
  fetchMonadStakeEarnEvents,
  formatMon,
  monadStakeEmptyInfo,
  MonadStakeAdapterError,
  scanMonadStake,
} from "../../web/src/lib/adapters/monad-stake";

const root = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/monad");
const fixture = JSON.parse(
  readFileSync(join(root, "getDelegator-sample.json"), "utf8"),
);

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

describe("Monad staking reader", () => {
  it("decodes getDelegator fixture payload", () => {
    const decoded = decodeGetDelegatorResult(fixture.encodedGetDelegatorResult);
    expect(decoded.stake).toBe(BigInt(fixture.stake));
    expect(decoded.unclaimedRewards).toBe(BigInt(fixture.unclaimedRewards));
    expect(decoded.deltaEpoch).toBe(BigInt(fixture.deltaEpoch));
  });

  it("encodes getDelegator call data with selector", () => {
    const data = encodeGetDelegatorCall(
      1n,
      "0x1111111111111111111111111111111111111111",
    );
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

  it("maps unclaimed rewards to EarnEvent", () => {
    const events = delegatorStatesToEarnEvents(
      "0x1111111111111111111111111111111111111111",
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

  it("preserves 1-wei dust rewards exactly", () => {
    expect(formatMon(1n)).toBe("0.000000000000000001");
    const events = delegatorStatesToEarnEvents(
      "0x1111111111111111111111111111111111111111",
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
    expect(
      delegatorStatesToEarnEvents(
        "0x1111111111111111111111111111111111111111",
        states,
      ),
    ).toEqual([]);
    expect(monadStakeEmptyInfo(states)).toMatch(/no unclaimed rewards/i);
  });

  it("explains bought-MON-but-not-staked", () => {
    expect(monadStakeEmptyInfo([])).toMatch(/Buying or holding MON/i);
  });

  it("fetchMonadStakeEarnEvents uses mock rpc and fails closed on empty", async () => {
    const events = await fetchMonadStakeEarnEvents(
      "0x1111111111111111111111111111111111111111",
      async () => fixture.encodedGetDelegatorResult,
      { validatorIds: [1n], asOf: new Date("2024-07-01T00:00:00.000Z") },
    );
    expect(events).toHaveLength(1);
    expect(events[0].amount).toBe("2.5");

    await expect(
      fetchMonadStakeEarnEvents(
        "0x1111111111111111111111111111111111111111",
        async () => "0x" as `0x${string}`,
        { validatorIds: [1n] },
      ),
    ).rejects.toBeInstanceOf(MonadStakeAdapterError);
  });

  it("rejects zero address", async () => {
    await expect(
      fetchMonadStakeEarnEvents(
        "0x0000000000000000000000000000000000000000",
        async () => "0x",
        { validatorIds: [1n] },
      ),
    ).rejects.toThrow(/Invalid delegator/);
  });

  it("lists delegations via getDelegations then fetches rewards", async () => {
    const delegationsEncoded = encodeDelegationsPage(true, 0n, [1n]);
    let calls = 0;
    const rpc2 = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return delegationsEncoded;
      return fixture.encodedGetDelegatorResult;
    });
    const events = await fetchMonadStakeEarnEvents(
      "0x1111111111111111111111111111111111111111",
      rpc2,
      { asOf: new Date("2024-07-01T00:00:00.000Z") },
    );
    expect(events).toHaveLength(1);
    expect(rpc2).toHaveBeenCalled();
  });

  it("returns empty info when no delegations", async () => {
    const empty = encodeDelegationsPage(true, 0n, []);
    const scan = await scanMonadStake(
      "0x1111111111111111111111111111111111111111",
      async () => empty,
    );
    expect(scan.events).toEqual([]);
    expect(scan.info).toMatch(/No Monad stake found/i);
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
});
