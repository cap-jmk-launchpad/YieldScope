"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";

type Mode = "oauth" | "keys";

export function ConnectPanel() {
  const [binanceMode, setBinanceMode] = useState<Mode>("oauth");
  const [okxMode, setOkxMode] = useState<Mode>("oauth");
  const [binanceKey, setBinanceKey] = useState("");
  const [binanceSecret, setBinanceSecret] = useState("");
  const [binanceToken, setBinanceToken] = useState("");
  const [okxKey, setOkxKey] = useState("");
  const [okxSecret, setOkxSecret] = useState("");
  const [okxPass, setOkxPass] = useState("");
  const [okxToken, setOkxToken] = useState("");
  const [saved, setSaved] = useState(false);
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  useEffect(() => {
    const raw = sessionStorage.getItem("yieldscope.creds");
    if (!raw) return;
    try {
      const c = JSON.parse(raw);
      if (c.binance?.accessToken) {
        setBinanceMode("oauth");
        setBinanceToken(c.binance.accessToken);
      } else if (c.binance?.apiKey) {
        setBinanceMode("keys");
        setBinanceKey(c.binance.apiKey);
        setBinanceSecret(c.binance.apiSecret ?? "");
      }
      if (c.okx?.accessToken) {
        setOkxMode("oauth");
        setOkxToken(c.okx.accessToken);
      } else if (c.okx?.apiKey) {
        setOkxMode("keys");
        setOkxKey(c.okx.apiKey);
        setOkxSecret(c.okx.apiSecret ?? "");
        setOkxPass(c.okx.passphrase ?? "");
      }
    } catch {
      /* ignore */
    }
  }, []);

  function onSave(e: FormEvent) {
    e.preventDefault();
    const payload: Record<string, unknown> = {};
    if (binanceMode === "oauth" && binanceToken) {
      payload.binance = { apiKey: "", apiSecret: "", accessToken: binanceToken };
    } else if (binanceMode === "keys" && binanceKey && binanceSecret) {
      payload.binance = { apiKey: binanceKey, apiSecret: binanceSecret };
    }
    if (okxMode === "oauth" && okxToken) {
      payload.okx = { apiKey: "", apiSecret: "", accessToken: okxToken };
    } else if (okxMode === "keys" && okxKey && okxSecret && okxPass) {
      payload.okx = {
        apiKey: okxKey,
        apiSecret: okxSecret,
        passphrase: okxPass,
      };
    }
    if (address) payload.address = address;
    sessionStorage.setItem("yieldscope.creds", JSON.stringify(payload));
    setSaved(true);
  }

  return (
    <form className="connect-panel" onSubmit={onSave}>
      <h2>Connect sources</h2>
      <p className="lede">
        OAuth first where available. Read-only API keys are the fallback — same
        Connect path either way. Keys stay in this browser session only.
      </p>

      <section>
        <div className="row">
          <h3>Binance Simple Earn</h3>
          <div className="toggle">
            <button
              type="button"
              className={binanceMode === "oauth" ? "on" : ""}
              onClick={() => setBinanceMode("oauth")}
            >
              OAuth
            </button>
            <button
              type="button"
              className={binanceMode === "keys" ? "on" : ""}
              onClick={() => setBinanceMode("keys")}
            >
              API keys
            </button>
          </div>
        </div>
        {binanceMode === "oauth" ? (
          <>
            <p className="hint">
              Partner OAuth is preferred. Paste a Binance access token if your
              app registration is ready; otherwise switch to read-only keys.
            </p>
            <label>
              Access token
              <input
                value={binanceToken}
                onChange={(e) => setBinanceToken(e.target.value)}
                placeholder="Bearer token from OAuth"
                autoComplete="off"
              />
            </label>
          </>
        ) : (
          <>
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
          </>
        )}
      </section>

      <section>
        <div className="row">
          <h3>OKX Earn</h3>
          <div className="toggle">
            <button
              type="button"
              className={okxMode === "oauth" ? "on" : ""}
              onClick={() => setOkxMode("oauth")}
            >
              OAuth
            </button>
            <button
              type="button"
              className={okxMode === "keys" ? "on" : ""}
              onClick={() => setOkxMode("keys")}
            >
              API keys
            </button>
          </div>
        </div>
        {okxMode === "oauth" ? (
          <label>
            Access token
            <input
              value={okxToken}
              onChange={(e) => setOkxToken(e.target.value)}
              placeholder="Bearer token from OAuth"
              autoComplete="off"
            />
          </label>
        ) : (
          <>
            <label>
              API key
              <input value={okxKey} onChange={(e) => setOkxKey(e.target.value)} autoComplete="off" />
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
          </>
        )}
      </section>

      <section>
        <h3>Monad wallet</h3>
        {isConnected ? (
          <p className="wallet">
            {address}{" "}
            <button type="button" className="linkish" onClick={() => disconnect()}>
              Disconnect
            </button>
          </p>
        ) : (
          <button
            type="button"
            className="btn-secondary"
            disabled={isPending || connectors.length === 0}
            onClick={() => connect({ connector: connectors[0] })}
          >
            {isPending ? "Connecting…" : "Connect wallet"}
          </button>
        )}
      </section>

      <button type="submit" className="btn-primary">
        Save connection
      </button>
      {saved ? <p className="ok">Saved for this session. Run Sync on the dashboard.</p> : null}
    </form>
  );
}
