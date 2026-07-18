# YieldScope

**One pane for what you actually earned** — Binance Simple Earn, OKX savings, and Monad staking — with an onchain checkpoint so the number is portable.

## Problem

Passive income is scattered. Binance Earn lives in Binance. OKX Earn lives in OKX. Monad staking rewards live onchain. Answering “what did I make this month?” means three apps and a spreadsheet.

## Solution

YieldScope syncs **earn-only** streams (not full portfolios) into one dashboard, then posts a Merkle-style root hash to `EarningsCheckpoint` on Monad so a sync window is explorer-verifiable.

## Phase 1 sources (only)

| Source | What we sync |
|--------|----------------|
| Binance | Simple Earn rewards / interest history |
| OKX | Savings / earn history |
| Monad | Staking unclaimed + accrued rewards via precompile `0x1000` |
| LUNC | Terra Classic pending staking rewards via public LCD |

No Zerion sprawl. No tax engine. No APY farm browser.

## Auth

1. **Email/password** via Supabase Auth (`/login`, `/register`). Registration requires email confirmation (sole bot gate — no captcha).
2. **Read-only API keys** for Binance / OKX in Connect UI (encrypted server-side per user).
3. Wallet connect (RainbowKit) for Monad stake reads and attestation.
4. Paste Terra Classic `terra1…` address (or explorer link) for LUNC stake rewards.
5. `/app/*` and sync/attest APIs are fail-closed without a session.

## Sync window

Dashboard sync supports **All time** (full available CEX history) or a **custom from/to date range** (`YYYY-MM-DD`, UTC day bounds).

| Source | Sync / persist | Display |
|--------|----------------|---------|
| Binance / OKX | History fetched for the selected window. Custom → merge-replace inside the window (rows outside are kept). All-time first run or “Re-download full history” → full replace. Later All-time → incremental upsert from high-water. | Full persisted ledger (picker is **not** a view filter) |
| Monad / LUNC | Point-in-time pending rewards — **date range ignored**; always full-replace snapshot | Current pending rows (`earnedAt` = sync time) |

Last-used window preference is stored in the browser (`localStorage`).

If exchange history in the ledger only spans a few days after a multi-year sync, use **Re-download full history** or sync a wider custom range (older truncating bugs capped loads at 500 rows).

## Fail closed

Each source shows `ok | error | not_connected`. Broken adapters never invent earn rows.

## Out of scope (Phase 2+)

ETH / Lido / Base / multi-chain DeFi aggregators — only after Phase 1 DoD is green.

## Hosting

- App: `yieldscope.d3bu7.com`
- Data: Supabase on blackpearl / engine
- Checkpoint: Monad testnet (chain id `10143`) for Spark; mainnet later
