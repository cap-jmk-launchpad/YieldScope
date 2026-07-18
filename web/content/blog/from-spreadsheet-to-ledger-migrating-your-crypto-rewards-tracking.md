---
title: "From spreadsheet to ledger: migrating your crypto rewards tracking"
description: "A practical path from monthly CSV paste to a synced earn-only ledger with optional Monad attestation."
primaryKeyword: "migrate crypto rewards spreadsheet to ledger"
source: "brand-pipeline"
---

# From spreadsheet to ledger: migrating your crypto rewards tracking

## Why spreadsheets stall

You export Binance earn, scrape OKX, glance at Monad pending, forget LUNC — then sum cells by hand. Next month the columns drift. Screenshots replace provenance.

## Migration path

1. **Inventory venues** you actually earn on today (Phase 1: Binance, OKX, Monad, LUNC).
2. **Create a YieldScope account** and connect read-only exchange keys + wallet / Terra address.
3. **Sync All time** once so history lands in the earn-only ledger (or a wide custom UTC range).
4. **Reconcile one known month** against your spreadsheet — fix keys/windows until rows match reality.
5. **Optional:** attest an `EarningsCheckpoint` root for that window on Monad.
6. **Retire the paste ritual** — use the ledger as source of truth; keep the sheet only if tax software still needs CSV later.

## What not to migrate

Spot balances, trade fills, and “paper gains.” Those belong in portfolio or tax tools. YieldScope keeps rewards rows so the monthly earn question stays sharp.

## Success criteria

You can answer “what did I earn last month?” from one dashboard, with source chips that are honest when a venue fails.
