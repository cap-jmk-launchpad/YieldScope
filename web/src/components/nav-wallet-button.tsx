"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";

type NavWalletButtonProps = {
  /** `nav` = compact top bar; `panel` = Connect / Attest forms */
  variant?: "nav" | "panel";
};

/**
 * Compact wallet control via ConnectButton.Custom so we own chrome
 * (no RainbowKit default pill fighting the YieldScope top bar).
 */
export function NavWalletButton({ variant = "nav" }: NavWalletButtonProps) {
  const isPanel = variant === "panel";
  const baseClass = isPanel
    ? "nav-wallet-btn nav-wallet-btn--panel"
    : "nav-wallet-btn";

  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        openAccountModal,
        openChainModal,
        openConnectModal,
        mounted,
      }) => {
        const ready = mounted;
        const connected = Boolean(ready && account && chain);

        if (!ready) {
          return (
            <button
              type="button"
              className={`${baseClass} nav-wallet-btn--ghost`}
              disabled
              aria-hidden
            >
              Wallet
            </button>
          );
        }

        if (!connected) {
          return (
            <button
              type="button"
              className={baseClass}
              onClick={openConnectModal}
            >
              <span className="nav-wallet-btn__full">Connect wallet</span>
              <span className="nav-wallet-btn__short">Wallet</span>
            </button>
          );
        }

        if (chain?.unsupported) {
          return (
            <button
              type="button"
              className={`${baseClass} nav-wallet-btn--warn`}
              onClick={openChainModal}
            >
              Wrong network
            </button>
          );
        }

        return (
          <button
            type="button"
            className={`${baseClass} nav-wallet-btn--connected`}
            onClick={openAccountModal}
            title={account?.address}
          >
            <span className="nav-wallet-btn__dot" aria-hidden />
            <span className="nav-wallet-btn__addr mono">
              {account?.displayName}
            </span>
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
