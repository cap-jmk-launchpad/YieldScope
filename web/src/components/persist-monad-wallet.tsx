"use client";

import { useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import { DEFAULT_MONAD_CHAIN_ID } from "@/lib/contracts";

/**
 * Persist Phantom / wagmi address to the user credentials store as soon as a
 * wallet connects — from any page (nav or Connect). Without this, Monad stays
 * `not_connected` until the user manually hits "Save connection".
 */
export function PersistMonadWallet() {
  const { address, isConnected, chainId } = useAccount();
  const lastSavedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isConnected || !address) return;
    const key = `${address.toLowerCase()}:${chainId ?? DEFAULT_MONAD_CHAIN_ID}`;
    if (lastSavedRef.current === key) return;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/credentials", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            walletAddress: address,
            chainId: chainId ?? DEFAULT_MONAD_CHAIN_ID,
          }),
        });
        if (cancelled || !res.ok) return;
        lastSavedRef.current = key;
        // Notify Connect panel (and any other listeners) to refresh status.
        window.dispatchEvent(
          new CustomEvent("yieldscope:wallet-persisted", {
            detail: { address, chainId: chainId ?? DEFAULT_MONAD_CHAIN_ID },
          }),
        );
      } catch {
        /* Sync still accepts a live address from the dashboard body. */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isConnected, address, chainId]);

  return null;
}
