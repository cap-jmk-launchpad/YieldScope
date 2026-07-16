"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getDefaultConfig, RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { type ReactNode, useState } from "react";
import { WagmiProvider, http } from "wagmi";
import { monadTestnet } from "@/lib/contracts";

// RainbowKit rejects empty projectId; `??` does not treat "" from .env.local as missing.
// In development only, fall back to RainbowKit's public demo id (see rainbowkit getWalletConnectConnector).
const RAINBOWKIT_DEMO_PROJECT_ID = "21fef48091f12692cad574a6f7753643";
const envProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();
const projectId =
  envProjectId ||
  (process.env.NODE_ENV === "development" ? RAINBOWKIT_DEMO_PROJECT_ID : "");

const config = getDefaultConfig({
  appName: "YieldScope",
  projectId,
  chains: [monadTestnet],
  transports: {
    [monadTestnet.id]: http(
      process.env.NEXT_PUBLIC_MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz",
    ),
  },
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
        <RainbowKitProvider theme={rkTheme} modalSize="compact">
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
