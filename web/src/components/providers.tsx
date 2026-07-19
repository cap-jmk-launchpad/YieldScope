"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  getDefaultConfig,
  RainbowKitProvider,
  darkTheme,
} from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { type ReactNode, useState } from "react";
import { WagmiProvider, http } from "wagmi";
import { defaultMonadRpcUrl, monadMainnet } from "@/lib/contracts";
import {
  isDemoWalletConnectProjectId,
  resolveWalletConnectProjectId,
} from "@/lib/wallet-config";
import { buildYieldScopeWalletList } from "@/lib/wallet-list";

const { projectId, source: projectIdSource } = resolveWalletConnectProjectId({
  envProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
  nodeEnv: process.env.NODE_ENV,
});

if (
  typeof window !== "undefined" &&
  isDemoWalletConnectProjectId(projectId) &&
  projectIdSource !== "dev-demo"
) {
  console.info(
    "[YieldScope] WalletConnect is using the shared RainbowKit demo project id. " +
      "For production reliability, set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID " +
      "(https://cloud.walletconnect.com) at image build time.",
  );
}

const config = getDefaultConfig({
  appName: "YieldScope",
  appDescription:
    "Monitor Binance, OKX, Monad stake, and LUNC rewards in one place.",
  appUrl: "https://yieldscope.d3bu7.com",
  projectId,
  // Monad mainnet (143) — Phantom connects in mainnet mode, not testnet.
  chains: [monadMainnet],
  transports: {
    [monadMainnet.id]: http(defaultMonadRpcUrl()),
  },
  // Injected Phantom / MetaMask / OKX in this browser first; WC QR for phone.
  // Avoid deep links that OS-route to another installed browser (e.g. Brave).
  wallets: buildYieldScopeWalletList(),
  ssr: true,
});

const rkTheme = darkTheme({
  accentColor: "#00efff",
  accentColorForeground: "#05080f",
  borderRadius: "small",
  fontStack: "system",
  overlayBlur: "small",
});

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={rkTheme}
          modalSize="compact"
          initialChain={monadMainnet}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
