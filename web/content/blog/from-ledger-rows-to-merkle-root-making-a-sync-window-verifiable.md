---
title: "From ledger rows to Merkle root: making a sync window verifiable"
description: "How YieldScope turns earn rows into an attest-able Merkle-style root."
primaryKeyword: "Merkle root earnings attestation"
source: "brand-seed"
---

# From ledger rows to Merkle root: making a sync window verifiable

## Rows first

Attestation without a trustworthy ledger is theater. Sync sources until chips read `ok` and the events table looks real.

## Then commit the window

A checkpoint hashes the earn set for a sync window into a root you can post on Monad. Explorers verify the commitment; they do not need your API keys.

## Operational tip

Attest when you care about portability — end of month, after a big sync, before sharing a total. Skip it when you are still debugging a broken adapter.
