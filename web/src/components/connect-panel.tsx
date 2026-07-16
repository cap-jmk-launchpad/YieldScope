"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { useEffect, useState, type FormEvent } from "react";

export function ConnectPanel() {
  const [binanceKey, setBinanceKey] = useState("");
  const [binanceSecret, setBinanceSecret] = useState("");
  const [okxKey, setOkxKey] = useState("");
  const [okxSecret, setOkxSecret] = useState("");
  const [okxPass, setOkxPass] = useState("");
  const [luncAddress, setLuncAddress] = useState("");
  const [saved, setSaved] = useState(false);
  const { address, isConnected } = useAccount();

  useEffect(() => {
    const raw = sessionStorage.getItem("yieldscope.creds");
    if (!raw) return;
    try {
      const c = JSON.parse(raw);
      if (c.binance?.apiKey) {
        setBinanceKey(c.binance.apiKey);
        setBinanceSecret(c.binance.apiSecret ?? "");
      }
      if (c.okx?.apiKey) {
        setOkxKey(c.okx.apiKey);
        setOkxSecret(c.okx.apiSecret ?? "");
        setOkxPass(c.okx.passphrase ?? "");
      }
      if (c.luncAddress) setLuncAddress(c.luncAddress);
    } catch {
      /* ignore */
    }
  }, []);

  function onSave(e: FormEvent) {
    e.preventDefault();
    const payload: Record<string, unknown> = {};
    if (binanceKey && binanceSecret) {
      payload.binance = { apiKey: binanceKey, apiSecret: binanceSecret };
    }
    if (okxKey && okxSecret && okxPass) {
      payload.okx = {
        apiKey: okxKey,
        apiSecret: okxSecret,
        passphrase: okxPass,
      };
    }
    if (address) payload.address = address;
    if (luncAddress.trim()) payload.luncAddress = luncAddress.trim();
    sessionStorage.setItem("yieldscope.creds", JSON.stringify(payload));
    setSaved(true);
  }

  return (
    <form className="connect-panel" onSubmit={onSave}>
      <h2>Connect sources</h2>
      <p className="lede">
        Paste <strong>read-only</strong> API keys for Binance / OKX, connect a
        Monad wallet, and paste a Terra Classic (LUNC) address. Credentials stay
        in this browser session only.
      </p>

      <section>
        <h3>Binance Simple Earn</h3>
        <p className="hint">
          Create a read-only API key in Binance → API Management. Leave trading
          disabled.
        </p>
        <label>
          API key
          <input
            value={binanceKey}
            onChange={(e) => setBinanceKey(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label>
          API secret
          <input
            type="password"
            value={binanceSecret}
            onChange={(e) => setBinanceSecret(e.target.value)}
            autoComplete="off"
          />
        </label>
      </section>

      <section>
        <h3>OKX Earn</h3>
        <p className="hint">
          Create a read-only API key in OKX → API. Include passphrase; leave
          trade and withdraw off.
        </p>
        <label>
          API key
          <input
            value={okxKey}
            onChange={(e) => setOkxKey(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label>
          Secret
          <input
            type="password"
            value={okxSecret}
            onChange={(e) => setOkxSecret(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label>
          Passphrase
          <input
            type="password"
            value={okxPass}
            onChange={(e) => setOkxPass(e.target.value)}
            autoComplete="off"
          />
        </label>
      </section>

      <section>
        <h3>Monad wallet</h3>
        <p className="hint">
          Connect MetaMask (or another injected wallet) on Monad testnet (chain
          id 10143) for stake reads and attestation.
        </p>
        <div className="wallet-connect">
          <ConnectButton
            chainStatus="icon"
            accountStatus="address"
            showBalance={false}
            label="Connect wallet"
          />
        </div>
        {isConnected && address ? (
          <p className="wallet">{address}</p>
        ) : null}
      </section>

      <section>
        <h3>LUNC (Terra Classic) stake</h3>
        <p className="hint">
          Paste a <code>terra1…</code> address or a Finder / Mintscan wallet
          link. We read pending staking rewards from the public LCD — no keys.
        </p>
        <label>
          Wallet address or link
          <input
            value={luncAddress}
            onChange={(e) => setLuncAddress(e.target.value)}
            placeholder="terra1… or https://finder.terra.money/…/address/terra1…"
            autoComplete="off"
          />
        </label>
      </section>

      <button type="submit" className="btn-primary">
        Save connection
      </button>
      {saved ? (
        <p className="ok">Saved for this session. Run Sync on the dashboard.</p>
      ) : null}
    </form>
  );
}
