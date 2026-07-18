---
title: "Reading Binance Simple Earn history without the spreadsheet spiral"
description: "How to think about Binance Simple Earn rewards as earn-only rows in one ledger."
primaryKeyword: "Binance Simple Earn rewards history"
source: "brand-seed"
---

# Reading Binance Simple Earn history without the spreadsheet spiral

## Earn-only, not the whole bag

Binance’s own Earn UI is strong — for Binance. The moment you also earn on OKX or stake on Monad, the spreadsheet appears.

YieldScope syncs **Simple Earn reward / interest history**, not your entire spot inventory. That keeps the question sharp: *what did I actually earn?*

## Practical habits

- Prefer **read-only** API keys scoped to what you need.
- Use **all-time** for a first honest baseline, then incremental syncs.
- If history looks truncated after a wide sync, re-download full history — do not invent rows.

## What we refuse

We will not invent earn rows when an adapter fails. Sources show `ok | error | not_connected`. Fail closed beats a pretty lie.

Binance is one stream. The product is the pane that holds all Phase 1 streams together.
