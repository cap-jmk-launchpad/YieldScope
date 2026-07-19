# YieldScope

**Solving scattered rewards. Track all your crypto rewards in one place** — Binance Simple Earn, OKX savings, Monad staking, and LUNC — with an onchain checkpoint so the number is portable.

## Problem

Passive income is scattered. Binance Earn lives in Binance. OKX Earn lives in OKX. Monad staking rewards live onchain. Answering “what did I make this month?” means three apps and a spreadsheet.

## Solution

YieldScope syncs **earn-only** streams (not full portfolios) into one dashboard, then posts a Merkle-style root hash to `EarningsCheckpoint` on Monad so a sync window is explorer-verifiable.

## Phase 1 sources (only)

| Source | What we sync |
|--------|----------------|
| Binance | Simple Earn rewards / interest history |
| OKX | Savings / Simple Earn interest via lending-history **`earnings`** (not principal `amt`), funding Auto lend bills (**type 400** / USDG **408** / Fixed **308·343**, plus legacy 126), and account Auto Earn (**type 381** `earnAmt`). Empty lending-history alone is not “no earnings.” If balance shows principal but all streams are empty → error (not silent ok/0). |
| Monad | Unclaimed staking rewards **and claimed `ClaimRewards`** from validators the wallet is/was delegated to. Pending via precompile `0x1000` `getDelegations` → `getDelegator`. Claimed via Etherscan V2 explorer logs (full history when `MONAD_EXPLORER_API_KEY` set) or chunked archive `eth_getLogs` (`MONAD_ARCHIVE_RPC_URL`, default Ankr public). Soft-degrades to pending-only if history APIs fail. Not arbitrary transfers. |
| LUNC | Terra Classic claimed staking rewards (FCD account history / autostake withdraws) + current pending via LCD |

No Zerion sprawl. No tax engine. No APY farm browser.

## Auth

1. **Email/password** via Supabase Auth (`/login`, `/register`). Registration requires email confirmation (sole bot gate — no captcha).
2. **Read-only API keys** for Binance / OKX in Connect UI (encrypted server-side per user).
3. Wallet connect (RainbowKit) for Monad stake reads and attestation.
4. Paste Terra Classic `terra1…` address (or explorer link) for LUNC stake rewards.
5. `/app/*` and sync/attest APIs are fail-closed without a session.

## Sync window

Dashboard sync supports three user-facing modes:

1. **Import missing since last sync** (default) — CEX (+ LUNC claim history) fetch only rows newer than each source’s high-water mark (with a 1-day overlap), then upsert. Does not wipe older rows. With **Auto-import on open** enabled (default), the dashboard quietly runs this once after load when you already have history.
2. **Re-download full history** — opt-in under that mode; full replace for CEX/LUNC claim streams.
3. **Date range** — custom `YYYY-MM-DD` window (UTC day bounds); merge-replace inside the window only.

| Source | Sync / persist | Display |
|--------|----------------|---------|
| Binance / OKX | History fetched for the selected window. Custom → merge-replace inside the window (rows outside are kept). First run or “Re-download full history” → full replace. Later “Import missing” → incremental upsert from high-water. | Full persisted ledger (picker is **not** a view filter) |
| Monad | Claimed `ClaimRewards` (explorer or archive RPC) for the selected window + current pending unclaimed from the wallet’s **current delegation set**. Soft-degrade: if history APIs fail, upsert pending only and keep prior claimed rows. Public `rpc.monad.xyz` getLogs is still ≤100 blocks — archive/explorer work around that. | Claimed rows at tx time + pending snapshot (`earnedAt` = sync time) |
| LUNC | Claimed `withdraw_rewards` / autostake history for the selected window (FCD; LCD fallback ~100d prune) + current pending when the range reaches today. Incremental when “Import missing”; pending snapshot still refreshes. | Claimed rows at tx time + pending snapshot (`earnedAt` = sync time) |

Last-used window + auto-import preference are stored in the browser (`localStorage`). Auto-import never force-full-syncs and never runs on a cold ledger (no prior history).

If exchange history in the ledger only spans a few days after a multi-year sync, use **Re-download full history** or sync a wider custom range (older truncating bugs capped loads at 500 rows).

OKX: if sync errors about missing interest while savings balance shows principal, or status is `ok` with **0 events** while the OKX app shows Earn, use **Re-download full history**. Interest is usually funding Auto lend (**type 400**) or account Auto Earn (**381**), not only legacy `INTEREST_DEPOSIT` (126). Confirm the API key is live (not demo) with Read permission.

## Monad claim history (workaround)

Public `rpc.monad.xyz` caps `eth_getLogs` at ~100 blocks, so YieldScope does **not** rebuild claim history from that endpoint.

| Path | When | Coverage |
|------|------|----------|
| Pending `getDelegator` | Always | Current unclaimed per validator in `getDelegations` |
| Etherscan API V2 logs (`MONAD_EXPLORER_API_KEY`) | Key set | Full indexed `ClaimRewards` for the wallet (recommended) |
| Archive RPC chunks (`MONAD_ARCHIVE_RPC_URL`, default Ankr `rpc3`) | No explorer key / explorer down | Recent window (`MONAD_CLAIM_HISTORY_MAX_BLOCKS`, default 500k ≈ days) |
| Soft-degrade | Both history paths fail | Pending only; prior claimed ledger rows kept |

**Still limited without an explorer key:** multi-month / full-mainnet claimed history and fully exited validators’ past claims need the free Etherscan key (Monad chainid `143`). Compound-before-ClaimRewards-event protocol versions may omit some compounds.

## Fail closed

Each source shows `ok | error | not_connected`. Broken adapters never invent earn rows.

## Out of scope (Phase 2+)

ETH / Lido / Base / multi-chain DeFi aggregators — only after Phase 1 DoD is green.

## Hosting

- App: `yieldscope.d3bu7.com`
- Data: Supabase on blackpearl / engine
- Wallet / stake sync: Monad **mainnet** (chain id `143`, RPC `https://rpc.monad.xyz`)
- Checkpoint: `EarningsCheckpoint` not deployed on mainnet yet (attest fail-closed). Historical Spark deploys used testnet `10143`.
