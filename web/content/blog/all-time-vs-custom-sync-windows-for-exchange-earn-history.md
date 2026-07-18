---
title: "All-time vs custom sync windows for exchange earn history"
description: "How YieldScope sync windows work for Binance/OKX history versus onchain snapshots."
primaryKeyword: "crypto earn sync date range"
source: "brand-seed"
---

# All-time vs custom sync windows for exchange earn history

## Windows are for CEX history

For Binance and OKX, pick **All time** or a **custom from/to** range (UTC day bounds). Custom syncs merge-replace inside the window; rows outside stay.

All-time first runs (or re-download full history) replace; later all-time runs incremental upsert from high-water.

## Onchain sources ignore the picker

Monad and LUNC pending rewards are always full-replace snapshots. The date picker is not a view filter on the ledger — it is a sync instruction for CEX history.

## Prefer honesty over aesthetics

If older rows are missing after a wide sync, re-download. Do not paper over adapter bugs with invented interest.
