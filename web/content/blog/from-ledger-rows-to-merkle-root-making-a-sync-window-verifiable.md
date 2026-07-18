---
title: "From ledger rows to Merkle root: making a sync window verifiable"
description: "How YieldScope turns earn rows into an attest-able Merkle-style root."
primaryKeyword: "Merkle root earnings attestation"
source: "brand-seed"
---

# From ledger rows to Merkle root: making a sync window verifiable

## Rows first

Attestation without a trustworthy ledger is theater. Sync Binance Simple Earn, OKX savings/earn, Monad staking, and LUNC until source chips read `ok` and the events table matches what those venues actually paid.

## Hash the window

YieldScope builds a Merkle-style root over the earn set for the chosen sync window. Each leaf is a deterministic encoding of an earn row (source, amount, time, identity). The root commits to that set without publishing every leaf onchain.

## Post the checkpoint

`EarningsCheckpoint` on Monad stores the root (and related metadata) so explorers can verify the commitment later. That is portable proof — not a screenshot of a dashboard.

## Operational tip

Attest when you care about portability — end of month, after a big sync, before sharing a total. Skip it while you are still debugging a broken adapter; fail-closed chips exist so you do not freeze fiction into a hash.
