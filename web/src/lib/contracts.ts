import { defineChain } from "viem";

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: {
      name: "Monadscan",
      url: "https://testnet.monadscan.com",
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

export const CHECKPOINT_ADDRESS = (process.env
  .NEXT_PUBLIC_CHECKPOINT_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as `0x${string}`;
