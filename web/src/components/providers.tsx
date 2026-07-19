"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  getDefaultConfig,
  RainbowKitProvider,
  darkTheme,
} from "@rainbow-me/rainbowkit";
import {
  injectedWallet,
  metaMaskWallet,
  okxWallet,
  phantomWallet,
  rainbowWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import "@rainbow-me/rainbowkit/styles.css";
import { type ReactNode, useState } from "react";
import { WagmiProvider, http } from "wagmi";
import { monadTestnet } from "@/lib/contracts";
import {
  isDemoWalletConnectProjectId,
  resolveWalletConnectProjectId,
} from "@/lib/wallet-config";

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
  chains: [monadTestnet],
  transports: {
    [monadTestnet.id]: http(
      process.env.NEXT_PUBLIC_MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz",
    ),
  },
  // Phantom (EVM) + WalletConnect for phone; MetaMask/OKX/Rainbow/injected for desktop.
  // LUNC stays address-paste — do not route Solana Phantom for Terra Classic.
  wallets: [
    {
      groupName: "Suggested",
      wallets: [
        phantomWallet,
        metaMaskWallet,
        rainbowWallet,
        okxWallet,
        injectedWallet,
        walletConnectWallet,
      ],
    },
  ],
  ssr: true,
});

const rkTheme = darkTheme({
  accentColor: "#3dffa8",
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
          initialChain={monadTestnet}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
