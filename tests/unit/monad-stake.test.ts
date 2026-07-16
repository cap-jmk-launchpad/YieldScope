import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeAbiParameters } from "viem";
import { describe, expect, it } from "vitest";
import {
  decodeGetDelegatorResult,
  delegatorStatesToEarnEvents,
  encodeGetDelegatorCall,
  fetchMonadStakeEarnEvents,
  MonadStakeAdapterError,
} from "../../web/src/lib/adapters/monad-stake";

const root = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/monad");
const fixture = JSON.parse(
  readFileSync(join(root, "getDelegator-sample.json"), "utf8"),
);

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

  it("returns empty when no stake and no rewards", () => {
    const events = delegatorStatesToEarnEvents(
      "0x1111111111111111111111111111111111111111",
      [
        {
          validatorId: 1n,
          stake: 0n,
          accRewardPerToken: 0n,
          unclaimedRewards: 0n,
          deltaStake: 0n,
          nextDeltaStake: 0n,
          deltaEpoch: 0n,
          nextDeltaEpoch: 0n,
        },
      ],
    );
    expect(events).toEqual([]);
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
