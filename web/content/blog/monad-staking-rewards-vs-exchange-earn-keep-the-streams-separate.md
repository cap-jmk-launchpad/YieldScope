---
title: "Monad staking rewards vs exchange earn: keep the streams separate"
description: "Why CEX earn interest and Monad staking rewards should share a ledger without being conflated."
primaryKeyword: "Monad staking rewards vs CEX earn"
source: "brand-seed"
---

# Monad staking rewards vs exchange earn: keep the streams separate

## Two different machines

Exchange Simple Earn / savings pay interest-like rewards through venue APIs. Monad staking accrues onchain. Mixing them into one “APY number” without provenance is how builders lose the plot.

YieldScope shows both in one pane **with source identity preserved** — Binance, OKX, Monad, LUNC — so you can still audit where a reward came from.

## Point-in-time vs history

CEX adapters pull history for a sync window. Monad (and LUNC) pending rewards are point-in-time snapshots: date range is ignored; we replace the snapshot honestly.

That asymmetry is intentional. Do not pretend a pending stake reward is a multi-year interest series.

## Checkpoint later

When the ledger is trustworthy, attest. The Merkle root covers the window you synced — including how each source contributed.
