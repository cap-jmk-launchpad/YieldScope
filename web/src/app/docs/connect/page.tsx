import type { Metadata } from "next";
import Link from "next/link";
import { DocsChrome } from "@/components/docs-chrome";

export const metadata: Metadata = {
  title: "Connect wallets and exchanges",
  description:
    "Step-by-step: Binance and OKX read-only API keys, Phantom on Monad mainnet, Terra Classic addresses, sync modes, and troubleshooting.",
  openGraph: {
    title: "Connect wallets and exchanges — YieldScope",
    description:
      "Step-by-step: Binance and OKX read-only API keys, Phantom on Monad mainnet, Terra Classic addresses, sync modes, and troubleshooting.",
    url: "/docs/connect",
    siteName: "YieldScope",
    type: "article",
  },
  twitter: {
    card: "summary_large_image",
    title: "Connect wallets and exchanges — YieldScope",
    description:
      "Step-by-step: Binance and OKX read-only API keys, Phantom on Monad mainnet, Terra Classic addresses, sync modes, and troubleshooting.",
  },
};

export default function DocsConnectPage() {
  return (
    <DocsChrome active="connect">
      <article className="docs-article">
        <p className="docs-kicker">
          <Link href="/docs">← Docs</Link>
        </p>
        <h1>Connect wallets and exchanges</h1>
        <p className="docs-lead">
          YieldScope syncs earn-only rewards — Binance Simple Earn, OKX savings,
          Monad staking, and LUNC — into one ledger. This guide covers each Phase
          1 source. We do not sync full spot portfolios, trades, or other chains
          yet.
        </p>

        <nav className="docs-toc" aria-label="On this page">
          <a href="#before">Before you connect</a>
          <a href="#binance">Binance</a>
          <a href="#okx">OKX</a>
          <a href="#monad">Monad</a>
          <a href="#lunc">LUNC</a>
          <a href="#sync">Sync modes</a>
          <a href="#status">Status meanings</a>
          <a href="#troubleshoot">Troubleshooting</a>
        </nav>

        <section id="before" className="docs-section">
          <h2>Before you connect</h2>
          <ol>
            <li>
              Create a YieldScope account at{" "}
              <Link href="/register">/register</Link>.
            </li>
            <li>
              Confirm your email (required — that link is the only bot gate;
              there is no captcha).
            </li>
            <li>
              Sign in, then open{" "}
              <Link href="/app/connect">Connect</Link>.
            </li>
            <li>
              After saving sources, go to the{" "}
              <Link href="/app">Dashboard</Link> and run Sync.
            </li>
          </ol>
          <p>
            <code>/app/*</code> and sync APIs are fail-closed without a session.
            You cannot sync while signed out.
          </p>
        </section>

        <section id="binance" className="docs-section">
          <h2>Binance (Simple Earn)</h2>
          <p>
            YieldScope reads <strong>Simple Earn rewards / interest history</strong>{" "}
            only — not your full Binance portfolio.
          </p>
          <h3>Create a read-only API key</h3>
          <ol>
            <li>
              Sign in to Binance → Profile →{" "}
              <strong>API Management</strong>.
            </li>
            <li>
              Create an API key. Name it clearly (e.g.{" "}
              <code>YieldScope-readonly</code>).
            </li>
            <li>
              Enable reading. Leave trading, withdrawals, and futures permissions{" "}
              <strong>off</strong>.
            </li>
            <li>Complete Binance 2FA / email prompts.</li>
            <li>
              Copy the API key and secret once — Binance shows the secret only at
              creation.
            </li>
          </ol>
          <h3>Paste in YieldScope</h3>
          <ol>
            <li>
              Open Connect → Exchanges → Binance.
            </li>
            <li>Paste API key and API secret.</li>
            <li>
              Click <strong>Save connection</strong>. Secrets are stored for your
              account and masked after save.
            </li>
            <li>On the Dashboard, run Sync.</li>
          </ol>
          <h3>Security</h3>
          <ul>
            <li>
              Use a <strong>read-only</strong> key. YieldScope never needs trade
              or withdraw rights.
            </li>
            <li>
              Do <strong>not</strong> enable withdrawals. If a key can withdraw,
              revoke it and create a new read-only key.
            </li>
            <li>
              Prefer IP allowlisting on Binance if you have a stable IP; otherwise
              keep the key read-only and rotate if leaked.
            </li>
            <li>
              Never paste keys into chat, screenshots, or git. YieldScope only
              asks for keys on Connect.
            </li>
          </ul>
        </section>

        <section id="okx" className="docs-section">
          <h2>OKX (savings / earn)</h2>
          <p>
            Sync pulls Simple Earn lending interest (<code>earnings</code>),
            funding Auto lend bills (type <code>400</code>+), Fixed Earn
            interest, and Trading Account Auto Earn (type <code>381</code>).
            Empty lending-history alone is not treated as “no earnings.”
          </p>
          <h3>Create a read-only API key</h3>
          <ol>
            <li>Sign in to OKX → API.</li>
            <li>
              Create an API key and set a <strong>passphrase</strong> — store it;
              OKX will not show it again.
            </li>
            <li>
              Permissions: <strong>Read</strong> only. Leave Trade and Withdraw
              off.
            </li>
            <li>
              Use a <strong>live</strong> account key, not demo/paper.
            </li>
            <li>Copy API key, secret, and passphrase.</li>
          </ol>
          <p>
            EEA/EU regional endpoints are detected automatically when you save
            credentials.
          </p>
          <h3>Paste in YieldScope</h3>
          <ol>
            <li>Open Connect → Exchanges → OKX.</li>
            <li>Paste API key, secret, and passphrase.</li>
            <li>
              Save connection, then Sync on the Dashboard.
            </li>
          </ol>
          <h3>Security</h3>
          <ul>
            <li>
              Read-only + passphrase. Never grant trade or withdraw.
            </li>
            <li>
              If sync errors mention passphrase or “API key not found,” re-save
              all three fields.
            </li>
          </ul>
        </section>

        <section id="monad" className="docs-section">
          <h2>Monad (Phantom)</h2>
          <p>
            YieldScope syncs staking rewards on Monad <strong>mainnet</strong>{" "}
            (chain id <code>143</code>): unclaimed rewards from validators you
            are delegated to, plus claimed <code>ClaimRewards</code> history when
            history APIs succeed.
          </p>
          <p>
            Holding MON without staking does <strong>not</strong> produce staking
            rewards. Arbitrary transfers are not imported.
          </p>
          <h3>Connect</h3>
          <ol>
            <li>
              Install the <strong>Phantom</strong> extension in{" "}
              <strong>the same browser</strong> you use for YieldScope — not only
              in Brave if you browse elsewhere.
            </li>
            <li>
              Open <Link href="/app/connect">Connect</Link> → Wallets → Monad.
            </li>
            <li>
              Click the wallet button and choose Phantom (the modal lists Phantom
              only).
            </li>
            <li>
              If prompted, choose <strong>Monad</strong> mainnet — not Monad
              Testnet.
            </li>
            <li>
              The address is <strong>saved automatically</strong> when you
              connect. Status should show connected with a shortened address.
            </li>
            <li>
              Dashboard → Sync.
            </li>
          </ol>
          <h3>Phone</h3>
          <p>
            Open YieldScope in Phantom’s in-app browser, or use WalletConnect QR
            from the Connect modal. Avoid <code>phantom://</code> deep links that
            hand off to another browser.
          </p>
          <h3>Important</h3>
          <ul>
            <li>
              <strong>Delegated stake only.</strong> If the wallet never staked,
              sync may succeed with 0 staking reward events — that is correct.
            </li>
            <li>
              Soft-degrade: if claimed-history APIs fail, YieldScope still
              refreshes pending unclaimed rewards and keeps prior claimed rows.
            </li>
          </ul>
        </section>

        <section id="lunc" className="docs-section">
          <h2>Terra Classic / LUNC</h2>
          <p>No API key. Paste a Terra Classic address.</p>
          <ol>
            <li>Open Connect → Wallets → Terra Classic.</li>
            <li>
              Paste a <code>terra1…</code> address, or a Finder / Mintscan wallet
              link. YieldScope normalizes explorer links to the address.
            </li>
            <li>Save connection, then Sync.</li>
          </ol>
          <p>
            Sync pulls claimed staking reward history for the selected window and
            refreshes pending rewards when the range includes today. This is not
            Solana Phantom — LUNC uses the Terra Classic address only.
          </p>
        </section>

        <section id="sync" className="docs-section">
          <h2>Sync modes</h2>
          <div className="docs-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Mode</th>
                  <th>What it does</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <strong>Import missing since last sync</strong> (default)
                  </td>
                  <td>
                    Fetches only rows newer than each source’s high-water mark
                    (with a short overlap), then upserts. Does not wipe older
                    rows.
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>Re-download full history</strong>
                  </td>
                  <td>
                    Opt-in under Import missing. Full replace for CEX / LUNC /
                    Monad claim streams. Use when history looks truncated or OKX
                    shows Earn in-app but 0 events.
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>Date range</strong>
                  </td>
                  <td>
                    Custom <code>YYYY-MM-DD</code> window (UTC day bounds).
                    Merge-replace inside the window only; rows outside are kept.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            Auto-import on open (default on) quietly runs Import missing once
            after load when you already have history. It never force-full-syncs
            and never runs on an empty ledger. The date picker is a sync window,
            not a view filter — the dashboard still shows your full persisted
            ledger.
          </p>
        </section>

        <section id="status" className="docs-section">
          <h2>Source status (fail-closed)</h2>
          <div className="docs-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Meaning</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <span className="docs-chip docs-chip-ok">ok</span>
                  </td>
                  <td>
                    Credentials or wallet are usable and the last sync for that
                    source succeeded (or soft-degraded as documented).
                  </td>
                </tr>
                <tr>
                  <td>
                    <span className="docs-chip docs-chip-error">error</span>
                  </td>
                  <td>
                    Sync failed. No invented earn rows. Read the error text; fix
                    credentials, permissions, or retry.
                  </td>
                </tr>
                <tr>
                  <td>
                    <span className="docs-chip docs-chip-muted">
                      not_connected
                    </span>
                  </td>
                  <td>
                    No saved key / address for that source yet.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            Broken adapters never invent earn rows to fill charts. Empty +{" "}
            <code>ok</code> can mean “connected, but nothing earned in range”
            (e.g. Monad wallet with no delegation).
          </p>
        </section>

        <section id="troubleshoot" className="docs-section">
          <h2>Troubleshooting</h2>
          <div className="docs-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Symptom</th>
                  <th>What to try</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Cannot open Connect / Sync</td>
                  <td>
                    Sign in. Confirm email if registration is pending.
                  </td>
                </tr>
                <tr>
                  <td>Binance / OKX auth errors</td>
                  <td>
                    Re-create a read-only key; re-paste key + secret (+ OKX
                    passphrase). Confirm live (not demo) for OKX.
                  </td>
                </tr>
                <tr>
                  <td>
                    OKX <code>ok</code> with 0 events but Earn in OKX app
                  </td>
                  <td>
                    Re-download full history. Confirm Read permission. Interest
                    is often Auto lend / Auto Earn.
                  </td>
                </tr>
                <tr>
                  <td>Phantom opens another browser</td>
                  <td>
                    Install Phantom in this browser’s extension store; avoid
                    deep-link handoff.
                  </td>
                </tr>
                <tr>
                  <td>Monad connected but 0 rewards</td>
                  <td>
                    Confirm you are delegated on Monad mainnet (143), not just
                    holding MON.
                  </td>
                </tr>
                <tr>
                  <td>LUNC address rejected</td>
                  <td>
                    Use <code>terra1…</code> or a Finder/Mintscan link that
                    contains that address.
                  </td>
                </tr>
                <tr>
                  <td>History only spans a few days</td>
                  <td>
                    Re-download full history or a wider custom date range.
                  </td>
                </tr>
                <tr>
                  <td>Attest disabled</td>
                  <td>
                    Expected until EarningsCheckpoint is configured on mainnet —
                    attest stays fail-closed. Connect and Sync still work.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="docs-section docs-scope">
          <h2>Phase 1 scope</h2>
          <p>
            <strong>In scope now:</strong> Binance Simple Earn, OKX savings/earn
            interest, Monad staking rewards (delegated), LUNC stake rewards.
          </p>
          <p>
            <strong>Not in Phase 1:</strong> ETH / Lido / Base / multi-chain DeFi
            aggregators, full portfolio balances, tax engines, APY farm browsers.
          </p>
          <p className="docs-next">
            Ready?{" "}
            <Link href="/register">Create an account</Link>
            {" · "}
            <Link href="/app/connect">Open Connect</Link>
          </p>
        </section>
      </article>
    </DocsChrome>
  );
}
