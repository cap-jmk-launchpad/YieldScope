import { defineChain } from "viem";

/** Official Monad mainnet — https://docs.monad.xyz/developer-essentials/network-information */
export const MONAD_MAINNET_CHAIN_ID = 143;
/** Monad testnet (Spark / historical checkpoint deploys). */
export const MONAD_TESTNET_CHAIN_ID = 10143;

/** Wallet connect + stake sync default to mainnet so Phantom does not force testnet mode. */
export const DEFAULT_MONAD_CHAIN_ID = MONAD_MAINNET_CHAIN_ID;

export const DEFAULT_MONAD_RPC_URL = "https://rpc.monad.xyz";
export const DEFAULT_MONAD_TESTNET_RPC_URL = "https://testnet-rpc.monad.xyz";

export const MONAD_MAINNET_EXPLORER_URL = "https://monadscan.com";
export const MONAD_TESTNET_EXPLORER_URL = "https://testnet.monadscan.com";

/**
 * EarningsCheckpoint address. Zero / unset = attest disabled (fail closed).
 * No mainnet deploy is checked into this repo yet — do not invent one.
 */
export const CHECKPOINT_ADDRESS = (process.env
  .NEXT_PUBLIC_CHECKPOINT_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

export function defaultMonadRpcUrl(envRpc?: string | undefined): string {
  const trimmed =
    (envRpc ??
      process.env.NEXT_PUBLIC_MONAD_RPC_URL ??
      process.env.MONAD_RPC_URL)?.trim() ?? "";
  return trimmed || DEFAULT_MONAD_RPC_URL;
}

export function defaultMonadChainId(envChainId?: string | undefined): number {
  const raw = envChainId ?? process.env.NEXT_PUBLIC_MONAD_CHAIN_ID;
  const parsed = Number(raw?.trim());
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  return DEFAULT_MONAD_CHAIN_ID;
}

export function monadExplorerTxUrl(
  hash: string,
  chainId: number = DEFAULT_MONAD_CHAIN_ID,
): string {
  const base =
    chainId === MONAD_TESTNET_CHAIN_ID
      ? MONAD_TESTNET_EXPLORER_URL
      : MONAD_MAINNET_EXPLORER_URL;
  return `${base}/tx/${hash}`;
}

export function isCheckpointConfigured(
  address: string = CHECKPOINT_ADDRESS,
): boolean {
  return Boolean(
    address &&
      address !== "0x0000000000000000000000000000000000000000" &&
      /^0x[a-fA-F0-9]{40}$/.test(address),
  );
}

export const monadMainnet = defineChain({
  id: MONAD_MAINNET_CHAIN_ID,
  name: "Monad",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: [defaultMonadRpcUrl()] },
  },
  blockExplorers: {
    default: {
      name: "Monadscan",
      url: MONAD_MAINNET_EXPLORER_URL,
    },
  },
});

/** Kept for local/testnet checkpoint deploys — not the wallet default. */
export const monadTestnet = defineChain({
  id: MONAD_TESTNET_CHAIN_ID,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: [DEFAULT_MONAD_TESTNET_RPC_URL] },
  },
  blockExplorers: {
    default: {
      name: "Monadscan",
      url: MONAD_TESTNET_EXPLORER_URL,
    },
  },
});

export const earningsCheckpointAbi = [
  {
    type: "function",
    name: "attest",
    stateMutability: "nonpayable",
    inputs: [
      { name: "root", type: "bytes32" },
      { name: "windowStart", type: "uint64" },
      { name: "windowEnd", type: "uint64" },
      { name: "uri", type: "string" },
    ],
    outputs: [{ name: "sequence", type: "uint256" }],
  },
  {
    type: "function",
    name: "latest",
    stateMutability: "view",
    inputs: [{ name: "subject", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "root", type: "bytes32" },
          { name: "windowStart", type: "uint64" },
          { name: "windowEnd", type: "uint64" },
          { name: "attestedAt", type: "uint64" },
          { name: "uri", type: "string" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "checkpointCount",
    stateMutability: "view",
    inputs: [{ name: "subject", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "event",
    name: "CheckpointAttested",
    inputs: [
      { name: "subject", type: "address", indexed: true },
      { name: "sequence", type: "uint256", indexed: true },
      { name: "root", type: "bytes32", indexed: false },
      { name: "windowStart", type: "uint64", indexed: false },
      { name: "windowEnd", type: "uint64", indexed: false },
      { name: "uri", type: "string", indexed: false },
    ],
  },
] as const;
