/**
 * WalletConnect / RainbowKit helpers.
 * NEXT_PUBLIC_* values are baked at Next.js build time.
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
