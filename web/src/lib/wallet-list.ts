/**
 * RainbowKit wallet list — client-only (imports RK wallets).
 * Prefer injected Phantom in this browser; WC QR for phone.
 */

import type { WalletList } from "@rainbow-me/rainbowkit";
import {
  injectedWallet,
  metaMaskWallet,
  okxWallet,
  phantomWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { preferInBrowserDownloadUrls } from "@/lib/wallet-config";

/**
 * Phantom for the current browser only: injected `window.phantom.ethereum`.
 * Strip mobile / generic download URLs that can spawn the OS-default browser
 * or a `phantom://` handoff. Install guidance stays in RainbowKit's extension
 * modal (Chrome/Firefox store links open as normal https tabs in *this* browser).
 */
export function phantomInBrowserWallet(
  ...args: Parameters<typeof phantomWallet>
): ReturnType<typeof phantomWallet> {
  const base = phantomWallet(...args);
  return {
    ...base,
    downloadUrls: preferInBrowserDownloadUrls(base.downloadUrls),
  };
}

/**
 * Wallet list for RainbowKit: injected Phantom first, WalletConnect last (QR only).
 * Omits Rainbow (desktop `rnbwapp.com` / deep-link path) to avoid cross-browser handoff.
 */
export function buildYieldScopeWalletList(): WalletList {
  return [
    {
      groupName: "This browser",
      wallets: [
        phantomInBrowserWallet,
        injectedWallet,
        metaMaskWallet,
        okxWallet,
      ],
    },
    {
      groupName: "Phone (QR)",
      wallets: [walletConnectWallet],
    },
  ];
}
