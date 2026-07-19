"use client";

import { useAccount } from "wagmi";
import { useEffect, useState, type FormEvent } from "react";
import { NavWalletButton } from "@/components/nav-wallet-button";
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

  return (
    <form className="connect-panel" onSubmit={onSave}>
      <h2>Connect sources</h2>
      <p className="lede">
        Paste <strong>read-only</strong> API keys for Binance / OKX, connect a
        Monad wallet, and paste a Terra Classic (LUNC) address. Keys and
        addresses are stored for your account — secrets stay masked after save.
      </p>

      <section>
        <div className="row">
          <h3>Binance Simple Earn</h3>
          <SavedBadge status={status.binance} label="API key" />
        </div>
        <p className="hint">
          Create a read-only API key in Binance → API Management. Leave trading
          disabled.
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
      </section>

      <section>
        <div className="row">
          <h3>OKX Earn</h3>
          <SavedBadge status={status.okx} label="API key" />
        </div>
        <p className="hint">
          Create a read-only API key in OKX → API. Include passphrase; leave
          trade and withdraw off. EEA/EU keys are detected automatically. Sync
          pulls Simple Earn lending interest (`earnings`), funding Auto lend
          bills (type 400+), Fixed Earn interest, and Trading Account Auto Earn
          (type 381).
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
              status.okx.configured ? "Enter new secret to replace" : undefined
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
      </section>

      <section>
        <div className="row">
          <h3>Monad wallet</h3>
          <SavedBadge status={status.monad_stake} label="Wallet" />
        </div>
        <p className="hint">
          Connect on Monad mainnet (chain {DEFAULT_MONAD_CHAIN_ID}) in{" "}
          <strong>this browser</strong> — use Phantom / MetaMask / OKX from the
          “This browser” group so we stay here (no handoff to Brave or another
          app). Install the Phantom extension in the browser you&apos;re using;
          if Phantom only lives in Brave, the OS may still open Brave via{" "}
          <code>phantom://</code>. On phone: open this site in Phantom&apos;s
          browser, or pick “Phone (QR)” and scan with the Phantom mobile app.
          Then hit Save connection. Use Monad (not Monad Testnet) if prompted.
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
      </section>

      <section>
        <div className="row">
          <h3>LUNC (Terra Classic) stake</h3>
          <SavedBadge status={status.lunc_stake} label="Address" />
        </div>
        <p className="hint">
          Paste a <code>terra1…</code> address or a Finder / Mintscan wallet
          link. Sync crawls <strong>claimed</strong> staking rewards from chain
          txs in the selected date range, and refreshes the current{" "}
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
      </section>

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

function SavedBadge({
  status,
  label,
}: {
  status: CredentialStatus;
  label: string;
}) {
  if (!status.configured) return null;
  return (
    <span className="saved-badge" title={`${label} configured`}>
      {status.keyHint ?? "•••• saved"} · configured
    </span>
  );
}
