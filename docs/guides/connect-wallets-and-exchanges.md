# Connect wallets and exchanges

**YieldScope** syncs earn-only rewards — Binance Simple Earn, OKX savings, Monad staking, and LUNC — into one ledger. This guide covers how to connect each Phase 1 source.

**Live app:** [https://yieldscope.d3bu7.com](https://yieldscope.d3bu7.com) · **In-app guide:** [/docs/connect](https://yieldscope.d3bu7.com/docs/connect)

Phase 1 is intentionally narrow. We do not sync full spot portfolios, trades, or other chains yet.

---

## Before you connect

1. **Create a YieldScope account** at [/register](https://yieldscope.d3bu7.com/register).
2. **Confirm your email** (required — that link is the only bot gate; there is no captcha).
3. **Sign in**, then open **Connect** ([/app/connect](https://yieldscope.d3bu7.com/app/connect)).
4. After saving sources, go to the **Dashboard** and run **Sync**.

`/app/*` and sync APIs are fail-closed without a session. You cannot sync while signed out.

---

## Exchanges

### Binance (Simple Earn)

YieldScope reads **Simple Earn rewards / interest history** only — not your full Binance portfolio.

#### Create a read-only API key

1. Sign in to [Binance](https://www.binance.com) → **Profile** → **API Management** (or search “API Management”).
2. Create an API key. Name it something clear (e.g. `YieldScope-readonly`).
3. **Enable reading** (default). Leave **Enable Spot & Margin Trading**, **Enable Withdrawals**, and any futures/trading permissions **off**.
4. Complete Binance security prompts (2FA, email, etc.).
5. Copy the **API key** and **secret** once. Binance shows the secret only at creation.

#### Paste in YieldScope

1. Open **Connect** → **Exchanges** → Binance.
2. Paste **API key** and **API secret**.
3. Click **Save connection**. Secrets are stored for your account and masked after save.
4. On the Dashboard, run **Sync**.

#### Security notes

- Use a **read-only** key. YieldScope never needs trade or withdraw rights.
- Do **not** enable withdrawals. If a key can withdraw, revoke it and create a new read-only key.
- Prefer IP allowlisting on Binance if you have a stable IP; otherwise keep the key read-only and rotate if leaked.
- Never paste keys into chat, screenshots, or git. YieldScope will not ask for keys outside Connect.

---

### OKX (savings / earn)

YieldScope syncs OKX **earn interest streams**, including:

- Simple Earn lending history (`earnings`, not principal amounts)
- Funding Auto lend bills (type **400**, plus related Fixed / USDG types)
- Account Auto Earn (type **381**)
- Legacy interest deposit where still present

Empty lending-history alone is not treated as “no earnings.” If your OKX app shows Earn balance but sync returns **0 events** with status `ok`, try **Re-download full history** and confirm the key is live (not demo) with **Read** permission.

#### Create a read-only API key

1. Sign in to [OKX](https://www.okx.com) → **API** (or Profile → API).
2. Create an API key. You will set a **passphrase** — store it; OKX will not show it again.
3. Permissions: **Read** only. Leave **Trade** and **Withdraw** off.
4. Use a **live** trading account key, not a demo/paper key.
5. Copy **API key**, **secret**, and **passphrase**.

EEA/EU regional endpoints are detected automatically when you save credentials in YieldScope.

#### Paste in YieldScope

1. Open **Connect** → **Exchanges** → OKX.
2. Paste **API key**, **secret**, and **passphrase**.
3. **Save connection**, then **Sync** on the Dashboard.

#### Security notes

- Read-only + passphrase. Never grant trade or withdraw.
- If sync errors mention passphrase or “API key not found,” re-save all three fields (key, secret, passphrase). Region mismatches are usually fixed by re-saving.

---

## Wallets

### Monad (Phantom)

YieldScope syncs **staking rewards** for a wallet on Monad **mainnet** (chain id **143**):

- **Unclaimed** rewards from validators you are currently delegated to
- **Claimed** `ClaimRewards` history (including compound-style claims) when history APIs succeed

It does **not** invent rows from arbitrary transfers, and holding MON without staking does **not** produce staking rewards.

#### Connect

1. Install the **Phantom** browser extension in **the same browser** you use for YieldScope (Chrome/Firefox extension here — not only in Brave if you browse elsewhere).
2. Open [/app/connect](https://yieldscope.d3bu7.com/app/connect) → **Wallets** → Monad.
3. Click the wallet button and choose **Phantom**. The Connect modal lists **Phantom only**.
4. If prompted for network, choose **Monad** (mainnet), not Monad Testnet.
5. The address is **saved automatically** when you connect (you can also hit **Save connection**). Status should show `connected` with a shortened address.
6. Go to the Dashboard and **Sync**.

#### Phone

Open YieldScope inside **Phantom’s in-app browser**, or use WalletConnect QR from the Connect modal. Avoid relying on `phantom://` deep links that hand off to another installed browser.

#### Important

- **Delegated stake only.** If the wallet never staked / is not delegated, sync may succeed with **0** staking reward events — that is correct, not a bug.
- Soft-degrade: if claimed-history APIs fail, YieldScope still refreshes **pending** unclaimed rewards and keeps prior claimed ledger rows.

---

### Terra Classic / LUNC

No API key. Paste a **Terra Classic** address.

1. Open **Connect** → **Wallets** → Terra Classic.
2. Paste a `terra1…` address, or a Finder / Mintscan wallet link (YieldScope normalizes explorer links to the address).
3. **Save connection**, then **Sync**.

Sync pulls **claimed** staking reward history for the selected window and refreshes **pending** rewards when the range includes today.

This is **not** Solana Phantom. LUNC uses the Terra Classic address only.

---

## Sync modes

On the Dashboard:

| Mode | What it does |
|------|----------------|
| **Import missing since last sync** (default) | Fetches only rows newer than each source’s high-water mark (with a short overlap), then upserts. Does not wipe older rows. |
| **Re-download full history** | Opt-in under Import missing. Full replace for CEX / LUNC / Monad claim streams. Use when history looks truncated or OKX shows Earn in-app but 0 events. |
| **Date range** | Custom `YYYY-MM-DD` window (UTC day bounds). Merge-replace **inside** the window only; rows outside are kept. |

**Auto-import on open** (default on) quietly runs Import missing once after load when you already have history. It never force-full-syncs and never runs on an empty ledger.

The date picker is a **sync window**, not a view filter — the dashboard still shows your full persisted ledger.

---

## Source status (fail-closed)

Each source reports one of:

| Status | Meaning |
|--------|---------|
| **ok** / Connected | Credentials or wallet are usable and the last sync for that source succeeded (or soft-degraded as documented). |
| **error** | Sync failed. No invented earn rows. Read the error text; fix credentials, permissions, or retry. |
| **not_connected** | No saved key / address for that source yet. |

Broken adapters **never invent earn rows** to fill charts. Empty + `ok` can mean “connected, but nothing earned in range” (e.g. Monad wallet with no delegation).

---

## Troubleshooting

| Symptom | What to try |
|---------|-------------|
| Cannot open Connect / Sync | Sign in. Confirm email if registration is pending. |
| Binance / OKX auth errors | Re-create a **read-only** key; re-paste key + secret (+ OKX passphrase). Confirm live (not demo) for OKX. |
| OKX `ok` with 0 events but Earn in OKX app | **Re-download full history**. Confirm Read permission. Interest is often Auto lend / Auto Earn, not only legacy deposit types. |
| Phantom opens another browser | Install Phantom in **this** browser’s extension store; avoid deep-link handoff. |
| Monad connected but 0 rewards | Confirm you are **delegated** on Monad mainnet (143), not just holding MON. |
| LUNC address rejected | Use `terra1…` or a Finder/Mintscan link that contains that address. |
| History only spans a few days after a long sync | **Re-download full history** or a wider custom date range. |
| Attest disabled | Expected until `EarningsCheckpoint` is configured on mainnet — attest stays fail-closed. Connect and Sync still work. |

---

## Phase 1 scope (honest)

**In scope now:** Binance Simple Earn, OKX savings/earn interest, Monad staking rewards (delegated), LUNC stake rewards.

**Not in Phase 1:** ETH / Lido / Base / multi-chain DeFi aggregators, full portfolio balances, tax engines, APY farm browsers.

Want another chain or earn source? Use **[Request a chain](https://yieldscope.d3bu7.com/app/connect#request-chain)** on Connect (sign-in required). We log requests for the backlog — no ship date implied.

---

## Related

- Product brief: [`PRODUCT.md`](../../PRODUCT.md)
- Pitch: [`docs/pitch.md`](../pitch.md)
- Hosted app: [https://yieldscope.d3bu7.com](https://yieldscope.d3bu7.com)
