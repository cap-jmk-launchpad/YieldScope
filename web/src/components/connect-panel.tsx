"use client";

import { useAccount } from "wagmi";
import { useEffect, useState, type FormEvent } from "react";
import { BrandIcon } from "@/components/brand-icon";
import { NavWalletButton } from "@/components/nav-wallet-button";
import {
  brandsInSection,
  SECTION_LABEL,
  type ConnectionBrand,
} from "@/lib/brand-icon";
import { DEFAULT_MONAD_CHAIN_ID } from "@/lib/contracts";

interface CredentialStatus {
  configured: boolean;
  keyHint?: string;
}

interface CredentialsStatusMap {
  binance: CredentialStatus;
  okx: CredentialStatus;
  lunc_stake: CredentialStatus;
  monad_stake: CredentialStatus;
}

const emptyStatus = (): CredentialsStatusMap => ({
  binance: { configured: false },
  okx: { configured: false },
  lunc_stake: { configured: false },
  monad_stake: { configured: false },
});

function connectionStatusLabel(configured: boolean): string {
  return configured ? "connected" : "not_connected";
}

export function ConnectPanel() {
  const [binanceKey, setBinanceKey] = useState("");
  const [binanceSecret, setBinanceSecret] = useState("");
  const [okxKey, setOkxKey] = useState("");
  const [okxSecret, setOkxSecret] = useState("");
  const [okxPass, setOkxPass] = useState("");
  const [luncAddress, setLuncAddress] = useState("");
  const [status, setStatus] = useState<CredentialsStatusMap>(emptyStatus);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { address, isConnected, chainId } = useAccount();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/credentials");
        const json = (await res.json()) as {
          status?: CredentialsStatusMap;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error ?? "Could not load saved credentials");
          return;
        }
        if (json.status) {
          setStatus({
            ...emptyStatus(),
            ...json.status,
            monad_stake:
              json.status.monad_stake ?? emptyStatus().monad_stake,
          });
        }
      } catch {
        if (!cancelled) setError("Could not load saved credentials");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    setJustSaved(false);

    const body: Record<string, unknown> = {};
    if (binanceKey.trim() || binanceSecret.trim()) {
      body.binance = {
        apiKey: binanceKey.trim(),
        apiSecret: binanceSecret.trim(),
      };
    }
    if (okxKey.trim() || okxSecret.trim() || okxPass.trim()) {
      body.okx = {
        apiKey: okxKey.trim(),
        apiSecret: okxSecret.trim(),
        passphrase: okxPass.trim(),
      };
    }
    if (luncAddress.trim()) body.luncAddress = luncAddress.trim();
    if (isConnected && address) {
      body.walletAddress = address;
      body.chainId = chainId ?? DEFAULT_MONAD_CHAIN_ID;
    }

    try {
      const res = await fetch("/api/credentials", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        message?: string;
        status?: CredentialsStatusMap;
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? "Save failed");
        return;
      }
      if (json.status) {
        setStatus({
          ...emptyStatus(),
          ...json.status,
          monad_stake: json.status.monad_stake ?? emptyStatus().monad_stake,
        });
      }
      setJustSaved(true);
      setMessage(json.message ?? "Saved successfully.");
      setBinanceKey("");
      setBinanceSecret("");
      setOkxKey("");
      setOkxSecret("");
      setOkxPass("");
      if (json.status?.lunc_stake?.configured) setLuncAddress("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function hintFor(brand: ConnectionBrand): string | undefined {
    const s = status[brand.id];
    if (!s?.configured) return undefined;
    return s.keyHint ?? "•••• saved";
  }

  const exchangeBrands = brandsInSection("exchanges");
  const walletBrands = brandsInSection("wallets");
  const binanceBrand = exchangeBrands[0]!;
  const okxBrand = exchangeBrands[1]!;
  const monadBrand = walletBrands[0]!;
  const terraBrand = walletBrands[1]!;

  return (
    <form className="connect-panel" onSubmit={onSave}>
      <h2>Connect sources</h2>
      <p className="lede">
        Paste <strong>read-only</strong> API keys for exchanges, connect a Monad
        wallet, and paste a Terra Classic (LUNC) address. Keys and addresses are
        stored for your account — secrets stay masked after save.
      </p>

      <div className="connection-overview" aria-label="Connection status">
        <ConnectionSectionList
          section="exchanges"
          status={status}
          hintFor={hintFor}
        />
        <ConnectionSectionList
          section="wallets"
          status={status}
          hintFor={hintFor}
        />
      </div>

      <div className="connect-sections">
        <section className="connect-group" aria-labelledby="exchanges-heading">
          <h3 id="exchanges-heading" className="connect-group-title">
            {SECTION_LABEL.exchanges}
          </h3>

          <div className="connect-source">
            <ConnectionRowHeader
              brand={binanceBrand}
              configured={status.binance.configured}
              hint={hintFor(binanceBrand)}
            />
            <p className="hint">
              Create a read-only API key in Binance → API Management. Leave
              trading disabled.
            </p>
            <label>
              API key
              <input
                value={binanceKey}
                onChange={(e) => {
                  setBinanceKey(e.target.value);
                  setJustSaved(false);
                }}
                placeholder={
                  status.binance.configured
                    ? "Enter new key to replace"
                    : undefined
                }
                autoComplete="off"
                disabled={saving}
              />
            </label>
            <label>
              API secret
              <input
                type="password"
                value={binanceSecret}
                onChange={(e) => {
                  setBinanceSecret(e.target.value);
                  setJustSaved(false);
                }}
                placeholder={
                  status.binance.configured
                    ? "Enter new secret to replace"
                    : undefined
                }
                autoComplete="off"
                disabled={saving}
              />
            </label>
          </div>

          <div className="connect-source">
            <ConnectionRowHeader
              brand={okxBrand}
              configured={status.okx.configured}
              hint={hintFor(okxBrand)}
            />
            <p className="hint">
              Create a read-only API key in OKX → API. Include passphrase; leave
              trade and withdraw off. EEA/EU keys are detected automatically.
              Sync pulls Simple Earn lending interest (`earnings`), funding Auto
              lend bills (type 400+), Fixed Earn interest, and Trading Account
              Auto Earn (type 381).
            </p>
            <label>
              API key
              <input
                value={okxKey}
                onChange={(e) => {
                  setOkxKey(e.target.value);
                  setJustSaved(false);
                }}
                placeholder={
                  status.okx.configured ? "Enter new key to replace" : undefined
                }
                autoComplete="off"
                disabled={saving}
              />
            </label>
            <label>
              Secret
              <input
                type="password"
                value={okxSecret}
                onChange={(e) => {
                  setOkxSecret(e.target.value);
                  setJustSaved(false);
                }}
                placeholder={
                  status.okx.configured
                    ? "Enter new secret to replace"
                    : undefined
                }
                autoComplete="off"
                disabled={saving}
              />
            </label>
            <label>
              Passphrase
              <input
                type="password"
                value={okxPass}
                onChange={(e) => {
                  setOkxPass(e.target.value);
                  setJustSaved(false);
                }}
                placeholder={
                  status.okx.configured
                    ? "Enter new passphrase to replace"
                    : undefined
                }
                autoComplete="off"
                disabled={saving}
              />
            </label>
          </div>
        </section>

        <section className="connect-group" aria-labelledby="wallets-heading">
          <h3 id="wallets-heading" className="connect-group-title">
            {SECTION_LABEL.wallets}
          </h3>

          <div className="connect-source">
            <ConnectionRowHeader
              brand={monadBrand}
              configured={status.monad_stake.configured}
              hint={hintFor(monadBrand)}
            />
            <p className="hint">
              Connect with <strong>Phantom</strong> on Monad mainnet (chain{" "}
              {DEFAULT_MONAD_CHAIN_ID}) in <strong>this browser</strong>. Install
              the Phantom extension here (not only in Brave) so we stay in-tab —
              no <code>phantom://</code> handoff. On phone: open this site in
              Phantom&apos;s in-app browser. Then hit Save connection. Use Monad
              (not Monad Testnet) if prompted.
            </p>
            <div className="wallet-connect">
              <NavWalletButton variant="panel" />
            </div>
            {isConnected && address ? (
              <p className="wallet">
                Connected {address}
                {status.monad_stake.configured ? " — ready to save" : ""}
              </p>
            ) : status.monad_stake.configured ? (
              <p className="ok">
                Saved wallet {status.monad_stake.keyHint}. Reconnect any time to
                replace it.
              </p>
            ) : null}
          </div>

          <div className="connect-source">
            <ConnectionRowHeader
              brand={terraBrand}
              configured={status.lunc_stake.configured}
              hint={hintFor(terraBrand)}
            />
            <p className="hint">
              Paste a <code>terra1…</code> address or a Finder / Mintscan wallet
              link. Sync crawls <strong>claimed</strong> staking rewards from
              chain txs in the selected date range, and refreshes the current{" "}
              <strong>pending</strong> snapshot when the range includes today. No
              keys needed.
            </p>
            <label>
              Wallet address or link
              <input
                value={luncAddress}
                onChange={(e) => {
                  setLuncAddress(e.target.value);
                  setJustSaved(false);
                }}
                placeholder={
                  status.lunc_stake.configured
                    ? "Enter new address to replace"
                    : "terra1… or https://finder.terra.money/…/address/terra1…"
                }
                autoComplete="off"
                disabled={saving}
              />
            </label>
          </div>
        </section>
      </div>

      <button type="submit" className="btn-primary" disabled={saving}>
        {saving ? "Saving…" : justSaved ? "Saved ✓" : "Save connection"}
      </button>
      {message ? (
        <p className="ok" role="status" aria-live="polite">
          {message} Run Sync on the dashboard.
        </p>
      ) : null}
      {error ? (
        <p className="err" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function ConnectionSectionList({
  section,
  status,
  hintFor,
}: {
  section: "exchanges" | "wallets";
  status: CredentialsStatusMap;
  hintFor: (brand: ConnectionBrand) => string | undefined;
}) {
  const brands = brandsInSection(section);
  return (
    <div className="connection-section">
      <h3 className="connection-section-title">{SECTION_LABEL[section]}</h3>
      <ul className="connection-list">
        {brands.map((brand) => {
          const configured = status[brand.id]?.configured ?? false;
          const hint = hintFor(brand);
          const statusKey = connectionStatusLabel(configured);
          return (
            <li
              key={brand.id}
              className={`connection-row status-${statusKey}`}
            >
              <BrandIcon slug={brand.slug} alt={brand.name} size="md" />
              <div className="connection-row-body">
                <span className="connection-row-name">{brand.name}</span>
                {hint ? (
                  <span className="connection-row-hint mono">{hint}</span>
                ) : (
                  <span className="connection-row-hint muted">
                    {brand.hintLabel} not set
                  </span>
                )}
              </div>
              <span className="connection-row-status">{statusKey}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ConnectionRowHeader({
  brand,
  configured,
  hint,
}: {
  brand: ConnectionBrand;
  configured: boolean;
  hint?: string;
}) {
  const statusKey = connectionStatusLabel(configured);
  return (
    <div className="connect-source-header">
      <BrandIcon slug={brand.slug} alt={brand.name} size="md" />
      <div className="connect-source-title">
        <h4>{brand.name}</h4>
        {hint ? (
          <span className="saved-badge" title={`${brand.hintLabel} configured`}>
            {hint} · configured
          </span>
        ) : (
          <span className={`connection-row-status status-${statusKey}`}>
            {statusKey}
          </span>
        )}
      </div>
    </div>
  );
}
