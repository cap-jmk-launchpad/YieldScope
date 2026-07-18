---
title: "Read-only keys for earn sync: scope, risk, and what YieldScope needs"
description: "How YieldScope uses read-only Binance/OKX API keys and why trading permissions are out of scope."
primaryKeyword: "read-only API keys crypto earn sync"
source: "brand-seed"
---

# Read-only keys for earn sync: scope, risk, and what YieldScope needs

## Least privilege

YieldScope asks for **read-only** exchange API keys so we can fetch earn history. We encrypt credentials server-side per user. We do not need withdraw or trade permissions for Phase 1 sync.

## What “read-only” still means

Read access can expose balances and history. Treat keys as secrets. Rotate if leaked. Revoke unused keys on the exchange.

## Wallet separate

Monad stake reads and attestation use wallet connect — not exchange keys. Keep the threat models separate in your head: CEX history sync vs onchain attest.

Trustworthy reporting starts with scoped access and fail-closed adapters — not maximal permissions “just in case.”
