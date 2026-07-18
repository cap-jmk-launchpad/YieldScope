---
title: "Attesting an earnings checkpoint: what explorers can and cannot see"
description: "What posting an EarningsCheckpoint root on Monad proves — and what stays private."
primaryKeyword: "EarningsCheckpoint Monad privacy"
source: "brand-pipeline"
---

# Attesting an earnings checkpoint: what explorers can and cannot see

## What you post

After a sync window looks right, YieldScope can commit a Merkle-style **root** of that earn set to `EarningsCheckpoint` on Monad. Explorers see a hash (and related metadata) — a portable checkpoint that the window existed as committed.

## What explorers cannot see

They do not receive your Binance/OKX API keys, your raw earn CSV, or a public dump of every interest row unless you choose to disclose proofs yourself. The checkpoint is a commitment, not a broadcast of private account history.

## What it is for

- End-of-month portability: “this is the root I attested for April.”
- Sharing a verifiable claim without screenshots.
- Separating **ledger truth** (your sync) from **proof** (onchain root).

## What it is not

Not a tax filing. Not a price oracle. Not a claim that every chain’s rewards are included — Phase 1 only covers Binance Simple Earn, OKX savings/earn, Monad staking, and LUNC.

## Operational tip

Attest after sources read `ok`. Attesting a half-synced window just freezes incomplete data in a hash.
