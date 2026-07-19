"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useEffect, useState } from "react";
import {
  useAccount,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import {
  CHECKPOINT_ADDRESS,
  earningsCheckpointAbi,
} from "@/lib/contracts";

interface Preview {
  root: `0x${string}`;
  windowStart: number;
  windowEnd: number;
  eventCount: number;
}

export function AttestPanel() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { address, isConnected } = useAccount();
  const { writeContract, data: hash, isPending, error: writeError } =
    useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/checkpoint/preview");
      setPreview(await res.json());
    })();
  }, []);

  async function refresh() {
    const res = await fetch("/api/checkpoint/preview");
    setPreview(await res.json());
  }

  function attest() {
    setError(null);
    if (!preview) return;
    if (
      !CHECKPOINT_ADDRESS ||
      CHECKPOINT_ADDRESS === "0x0000000000000000000000000000000000000000"
    ) {
      setError("Checkpoint isn’t available yet. Try again later.");
      return;
    }
    if (!isConnected || !address) {
      setError("Connect a Monad wallet first.");
      return;
    }
    writeContract({
      address: CHECKPOINT_ADDRESS,
      abi: earningsCheckpointAbi,
      functionName: "attest",
      args: [
        preview.root,
        BigInt(preview.windowStart),
        BigInt(preview.windowEnd),
        `yieldscope:events:${preview.eventCount}`,
      ],
    });
  }

  const windowLabel =
    preview &&
    `${new Date(preview.windowStart * 1000).toLocaleString()} → ${new Date(
      preview.windowEnd * 1000,
    ).toLocaleString()}`;

  return (
    <div className="attest-panel">
      <h2>Attest checkpoint</h2>
      <p className="lede">
        Publish a fingerprint of your current earn ledger on Monad so others can
        verify the total on an explorer.
      </p>
      {preview ? (
        <dl>
          <div>
            <dt>Events</dt>
            <dd className="mono">{preview.eventCount}</dd>
          </div>
          <div>
            <dt>Fingerprint</dt>
            <dd className="mono break">{preview.root}</dd>
          </div>
          <div>
            <dt>Window</dt>
            <dd className="mono">{windowLabel}</dd>
          </div>
        </dl>
      ) : (
        <p className="lede">Loading preview…</p>
      )}
      {!isConnected ? (
        <div className="wallet-connect">
          <ConnectButton
            label="Connect wallet"
            showBalance={false}
            chainStatus={{
              smallScreen: "none",
              largeScreen: "icon",
            }}
            accountStatus={{
              smallScreen: "avatar",
              largeScreen: "address",
            }}
          />
        </div>
      ) : null}
      <div className="actions">
        <button type="button" className="btn-secondary" onClick={() => refresh()}>
          Refresh preview
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={isPending || confirming || !preview || !isConnected}
          onClick={attest}
        >
          {isPending || confirming ? "Attesting…" : "Attest on Monad"}
        </button>
      </div>
      {error ? <p className="err">{error}</p> : null}
      {writeError ? <p className="err">{writeError.message}</p> : null}
      {isSuccess && hash ? (
        <p className="ok">
          Attested.{" "}
          <a
            href={`https://testnet.monadscan.com/tx/${hash}`}
            target="_blank"
            rel="noreferrer"
          >
            View on Monadscan
          </a>
        </p>
      ) : null}
    </div>
  );
}
