/**
 * RainbowKit wallet list — client-only (imports RK wallets).
 * Phantom only (injected in the current browser). Untested wallets stay out.
 */

import type { WalletList } from "@rainbow-me/rainbowkit";
import { phantomWallet } from "@rainbow-me/rainbowkit/wallets";
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
 * Wallet list for RainbowKit: Phantom only.
 * Omits MetaMask, OKX, generic injected, Rainbow, and a separate WalletConnect
 * row so the modal does not advertise untested wallets.
 */
export function buildYieldScopeWalletList(): WalletList {
  return [
    {
      groupName: "Connect",
      wallets: [phantomInBrowserWallet],
    },
  ];
}
