---
title: "When OKX shows Earn but your ledger says zero"
description: "Why empty lending-history alone is not 'no earnings' — and how to recover a real OKX earn sync."
primaryKeyword: "OKX earn history empty ledger"
source: "brand-pipeline"
---

# When OKX shows Earn but your ledger says zero

## The trap

OKX’s app shows Savings / Auto Earn balances. Your sync returns `ok` with **0 events**. That usually means the adapter looked at the wrong stream — or the key cannot see the right one — not that you earned nothing.

## Where interest actually lives

YieldScope treats OKX earn as multiple streams:

- Lending-history **`earnings`** (interest), not principal `amt`
- Funding Auto lend bills (type **400**, USDG **408**, Fixed **308·343**, plus legacy **126**)
- Account Auto Earn (type **381** `earnAmt`)

Empty lending-history alone is **not** proof of zero earnings.

## Recovery checklist

1. Confirm the API key is **live** (not demo) with Read permission.
2. Run **Re-download full history** (or a wider custom UTC range).
3. If balance shows principal and every stream is empty → expect an **error**, not a silent success.
4. Compare a known recent interest credit in the OKX UI to a ledger row after sync.

## Product stance

Scattered rewards already hide in interface noise. A rewards ledger must fail closed when streams disagree — inventing zeros is worse than surfacing an error chip.
