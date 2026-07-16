# YieldScope — Spark pitch

## 30-second pitch

> I earn on Binance and OKX and stake on Monad, and I still can’t answer “what did I make this month?” without three apps and a spreadsheet. YieldScope syncs those earn streams into one dashboard and posts a hash checkpoint on Monad so the number is portable and verifiable — built test-first so every source actually works.

## Competitors & differentiation

| Competitor | What they do | Gap vs YieldScope |
|------------|--------------|-------------------|
| **Binance Earn / OKX Earn** (native UIs) | Strong in-app earn history — one venue each | No cross-exchange total; no Monad stake; no portable proof |
| **CoinStats / CoinTracker / Koinly** | Broad portfolio + tax; exchange sync | Balance/trade/tax-first, not a sharp “passive income only” product; no Monad attestation |
| **Capitally / Foliolytic / AllInvestView** | Binance CSV / multi-broker P&L + income | Accounting/CSV-heavy; not live dual-CEX earn + Monad stake |
| **Zerion / DeBank / Octav** | Best-in-class onchain DeFi/staking | Weak/no first-class CEX Simple Earn history; not Monad-native attestation |
| **Lido Rewards / per-protocol UIs** | Deep rewards for one protocol | Siloed; ignores CEX earn |
| **APY scanners / yield browsers** | Farm discovery & APY shopping | Discovery ≠ your personal accrued earnings ledger |

**Whitespace:** A narrow product about **what you actually earned** across **Binance + OKX earn + Monad staking**, with **keys-based CEX connect**, **test-proven adapters**, and an **onchain checkpoint**.

### How we are different

1. **Earn-native, not portfolio-native** — Rewards/interest/staking accrual, not the whole spot bag.
2. **CeFi + Monad in one pane** — Competitors pick CEX *or* DeFi; we bridge both for this personal pain.
3. **Read-only keys + wallet** — Explicit, scoped CEX credentials plus Monad wallet for stake/attest.
4. **Proof, not screenshots** — `EarningsCheckpoint` on Monad makes a sync window explorer-verifiable.
5. **Depth over breadth** — Three sources that pass tests (Phase 2 expands later).

### Anti-positioning

Phase 1 does **not** try to beat Zerion at DeFi coverage or Koinly at taxes. We own the **personal CeFi earn + Monad stake ledger + attestation** niche.
