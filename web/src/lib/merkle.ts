import { concat, hexToBytes, keccak256, stringToBytes } from "viem";
import type { EarnEvent } from "./adapters/types";

/** Deterministic leaf for an earn event (canonical JSON fields). */
export function earnEventLeaf(event: EarnEvent): `0x${string}` {
  const canonical = JSON.stringify({
    id: event.id,
    source: event.source,
    asset: event.asset,
    amount: event.amount,
    earnedAt: event.earnedAt,
  });
  return keccak256(stringToBytes(canonical));
}

/** Simple pairwise Merkle root (sorted siblings). Empty → zero hash. */
export function merkleRoot(events: EarnEvent[]): `0x${string}` {
  if (events.length === 0) {
    return ("0x" + "00".repeat(32)) as `0x${string}`;
  }
  let level = events.map(earnEventLeaf).sort();
  while (level.length > 1) {
    const next: `0x${string}`[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] ?? left;
      const [a, b] = left <= right ? [left, right] : [right, left];
      next.push(keccak256(concat([hexToBytes(a), hexToBytes(b)])));
    }
    level = next.sort();
  }
  return level[0];
}

export function windowBounds(events: EarnEvent[]): {
  windowStart: number;
  windowEnd: number;
} {
  if (events.length === 0) {
    const now = Math.floor(Date.now() / 1000);
    return { windowStart: now, windowEnd: now };
  }
  const times = events.map((e) => Math.floor(new Date(e.earnedAt).getTime() / 1000));
  return {
    windowStart: Math.min(...times),
    windowEnd: Math.max(...times),
  };
}

export function describeRoot(root: `0x${string}`): string {
  return root;
}
