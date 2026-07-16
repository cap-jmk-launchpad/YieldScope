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

No Zerion sprawl. No tax engine. No APY farm browser.

## Auth

1. **OAuth first** where the exchange supports a partner flow.
2. **Read-only API keys** as explicit fallback in the same Connect UI.
3. Wallet connect for Monad stake reads and attestation.

## Fail closed

Each source shows `ok | error | not_connected`. Broken adapters never invent earn rows.

## Out of scope (Phase 2+)

ETH / Lido / Base / multi-chain DeFi aggregators — only after Phase 1 DoD is green.

## Hosting

- App: `yieldscope.d3bu7.com`
- Data: Supabase on blackpearl / engine
- Checkpoint: Monad testnet (chain id `10143`) for Spark; mainnet later
