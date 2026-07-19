/**
 * WalletConnect / RainbowKit helpers (pure — safe for node unit tests).
 * NEXT_PUBLIC_* values are baked at Next.js build time.
 *
 * Connect UX: prefer injected wallets in the *current* browser. Do not rely on
 * `phantom://` / app deep links — those can hand off to whatever browser
 * registered the protocol (often Brave if Phantom was installed there first).
 * Phone users should use WalletConnect QR (in-modal overlay) or Phantom's
 * in-app browser — not a desktop deep link.
 */

/** RainbowKit public demo project id — fine for local; prefer a dedicated id in prod. */
export const RAINBOWKIT_DEMO_PROJECT_ID =
  "21fef48091f12692cad574a6f7753643";

export type WalletConnectProjectIdSource =
  | "env"
  | "dev-demo"
  | "prod-demo-fallback"
  | "missing";

export function resolveWalletConnectProjectId(opts: {
  envProjectId: string | undefined;
  nodeEnv: string | undefined;
}): { projectId: string; source: WalletConnectProjectIdSource } {
  const trimmed = opts.envProjectId?.trim() ?? "";
  if (trimmed) {
    return { projectId: trimmed, source: "env" };
  }
  if (opts.nodeEnv === "development") {
    return { projectId: RAINBOWKIT_DEMO_PROJECT_ID, source: "dev-demo" };
  }
  // Production builds historically fell back to the shared demo id so WalletConnect
  // QR / mobile deep-links still work when the deploy env forgot to set a project id.
  // Prefer setting NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID at image build time.
  return {
    projectId: RAINBOWKIT_DEMO_PROJECT_ID,
    source: "prod-demo-fallback",
  };
}

export function isDemoWalletConnectProjectId(projectId: string): boolean {
  return projectId === RAINBOWKIT_DEMO_PROJECT_ID;
}

/** Documented wallet order — unit-tested; keep in sync with buildYieldScopeWalletList. */
export const YIELDSCOPE_WALLET_GROUP_IDS = [
  {
    groupName: "This browser",
    walletIds: ["phantom", "injected", "metaMask", "okx"] as const,
  },
  {
    groupName: "Phone (QR)",
    walletIds: ["walletConnect"] as const,
  },
] as const;

export type WalletDownloadUrls = {
  android?: string;
  ios?: string;
  mobile?: string;
  qrCode?: string;
  chrome?: string;
  firefox?: string;
  browserExtension?: string;
  [key: string]: string | undefined;
};

/**
 * Keep only extension-store https links for the current browser.
 * Drops mobile / generic download targets that can hand off to the OS-default
 * browser or a `phantom://` protocol handler.
 */
export function preferInBrowserDownloadUrls(
  downloadUrls: WalletDownloadUrls | undefined,
): Pick<WalletDownloadUrls, "chrome" | "firefox"> {
  return {
    chrome: downloadUrls?.chrome,
    firefox: downloadUrls?.firefox,
  };
}
