# YieldScope — Spark pitch

## Locked one-liner

> **Solving scattered rewards. Track all your crypto rewards in one place.**

## 30-second pitch

Rewards are scattered across Binance, OKX, Monad staking, and LUNC. Answering “what did I make this month?” still means three apps and a spreadsheet. YieldScope syncs those earn streams into one ledger and posts a hash checkpoint on Monad so the number is portable and verifiable — built test-first so every source actually works.

## Positioning map

| Layer | Statement |
|-------|-----------|
| Problem | Scattered rewards across exchanges and chains |
| Promise | One place to track your crypto rewards |
| Phase 1 scope | Binance Simple Earn, OKX savings, Monad staking, LUNC — not every chain yet |
| Differentiator | Earn-only ledger + `EarningsCheckpoint` on Monad |
| Anti-positioning | Not Zerion (full DeFi), not Koinly (tax), not APY farm browsers |

## Competitors & differentiation

| Competitor | What they do | Gap vs YieldScope |
|------------|--------------|-------------------|
| **Binance Earn / OKX Earn** (native UIs) | Strong in-app earn history — one venue each | No cross-exchange total; no Monad stake; no portable proof |
| **CoinStats / CoinTracker / Koinly** | Broad portfolio + tax; exchange sync | Balance/trade/tax-first, not a sharp “rewards only” product; no Monad attestation |
| **Capitally / Foliolytic / AllInvestView** | Binance CSV / multi-broker P&L + income | Accounting/CSV-heavy; not live dual-CEX earn + Monad stake |
| **Zerion / DeBank / Octav** | Best-in-class onchain DeFi/staking | Weak/no first-class CEX Simple Earn history; not Monad-native attestation |
| **Lido Rewards / per-protocol UIs** | Deep rewards for one protocol | Siloed; ignores CEX earn |
| **APY scanners / yield browsers** | Farm discovery & APY shopping | Discovery ≠ your personal accrued rewards ledger |

**Whitespace:** A narrow product about **what you actually earned** across **Binance + OKX earn + Monad staking (+ LUNC)**, with **keys-based CEX connect**, **test-proven adapters**, and an **onchain checkpoint**.

### How we are different

1. **Earn-native, not portfolio-native** — Rewards/interest/staking accrual, not the whole spot bag.
2. **CeFi + Monad in one pane** — Competitors pick CEX *or* DeFi; we bridge both for this personal pain.
3. **Read-only keys + wallet** — Explicit, scoped CEX credentials plus Monad wallet for stake/attest.
4. **Proof, not screenshots** — `EarningsCheckpoint` on Monad makes a sync window explorer-verifiable.
5. **Depth over breadth** — Phase 1 sources that pass tests; expand later.

### Anti-positioning

Phase 1 does **not** try to beat Zerion at DeFi coverage or Koinly at taxes. We own the **personal CeFi earn + Monad stake ledger + attestation** niche.
