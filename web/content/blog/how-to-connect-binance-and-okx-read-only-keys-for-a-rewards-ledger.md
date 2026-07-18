---
title: "How to connect Binance and OKX read-only keys for a rewards ledger"
description: "A practical checklist for scoping API keys so YieldScope can sync earn history without trading permissions."
primaryKeyword: "read-only Binance OKX API keys earn sync"
source: "brand-pipeline"
---

# How to connect Binance and OKX read-only keys for a rewards ledger

## Goal

Give YieldScope enough read access to pull earn history — nothing that can place orders.

## Binance

1. Create an API key with **read** enabled for the account that holds Simple Earn.
2. Disable withdrawals and trading if the exchange UI exposes those toggles.
3. Paste the key + secret into YieldScope Connect; credentials are encrypted server-side per user.
4. Sync **All time** once, or pick a custom UTC window if you only need a slice.

## OKX

1. Use a **live** trading account key with Read permission — demo keys will not surface real earn streams.
2. Expect interest to show up via lending-history earnings and funding Auto lend / account Auto Earn bill types — not only legacy `INTEREST_DEPOSIT`.
3. If balance shows principal but the ledger is empty, treat that as an error path: use **Re-download full history**, do not accept silent zero.

## What YieldScope does not need

Trading permission, withdrawal permission, or keys for venues outside Phase 1. Wallet connect is separate and only for Monad stake reads / attestation.

## Fail closed

Each source shows `ok | error | not_connected`. A broken key never invents earn rows.
