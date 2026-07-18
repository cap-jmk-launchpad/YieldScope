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

## Landing + motion (brand surface)

- Hero: **YieldScope** wordmark → “Solving scattered rewards.” → one support sentence naming Phase 1 sources → **Track my rewards** / Sign in.
- Motion: wordmark rise (~600ms), cyan radial pulse (8s opacity loop), CTA underline draw on hover, section reveal on scroll; all honor `prefers-reduced-motion`.
- No hero cards, stat strips, or floating badges.

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

## Brand source

Majico staging project `27834995-58fb-4c5c-98fc-76936193f679` — see [`brand.md`](../brand.md), [`design.md`](../design.md), [`docs/majico/`](majico/).

### Pipeline note (2026-07-18 retry)

Generation is **async**: trigger → poll `get_asset_status` → retrieve export/`get_cursor_handoff`. Verified working after poll: `submit_brief` / niche research, `run_blog_research`, `generate_asset` (landing-page), `generate_creative`, `download_export_zip`, `select_logo` (creates handoff). Still broken or stubbed after completion: `generate_blog_outline` returns `result.stub: true` (blocks approve/section/assemble/publish), `list_palette_options` / `sync_cursor_skills` / `get_ui_ux_skills` 500, `list_logo_candidates` needs `MAJICO_PREVIEW_TOKEN_SECRET`, `guideline-html` fails with missing pipeline adapter, creative hero is mock placeholder.
