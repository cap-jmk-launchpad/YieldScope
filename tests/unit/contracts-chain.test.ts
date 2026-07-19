import { describe, expect, it } from "vitest";
import {
  CHECKPOINT_ADDRESS,
  DEFAULT_MONAD_CHAIN_ID,
  DEFAULT_MONAD_RPC_URL,
  MONAD_MAINNET_CHAIN_ID,
  MONAD_TESTNET_CHAIN_ID,
  defaultMonadChainId,
  defaultMonadRpcUrl,
  isCheckpointConfigured,
  monadExplorerTxUrl,
  monadMainnet,
} from "../../web/src/lib/contracts";

describe("Monad chain config", () => {
  it("defaults wallet/sync to Monad mainnet (143)", () => {
    expect(DEFAULT_MONAD_CHAIN_ID).toBe(143);
    expect(MONAD_MAINNET_CHAIN_ID).toBe(143);
    expect(MONAD_TESTNET_CHAIN_ID).toBe(10143);
    expect(monadMainnet.id).toBe(143);
    expect(defaultMonadChainId(undefined)).toBe(143);
    expect(defaultMonadChainId("")).toBe(143);
    expect(defaultMonadChainId("  ")).toBe(143);
  });

  it("honors an explicit chain id env override", () => {
    expect(defaultMonadChainId("10143")).toBe(10143);
    expect(defaultMonadChainId("143")).toBe(143);
  });

  it("defaults RPC to official mainnet endpoint", () => {
    expect(DEFAULT_MONAD_RPC_URL).toBe("https://rpc.monad.xyz");
    expect(defaultMonadRpcUrl(undefined)).toBe("https://rpc.monad.xyz");
    expect(defaultMonadRpcUrl("")).toBe("https://rpc.monad.xyz");
    expect(defaultMonadRpcUrl("  https://rpc1.monad.xyz  ")).toBe(
      "https://rpc1.monad.xyz",
    );
  });

  it("builds explorer tx urls for mainnet vs testnet", () => {
    expect(monadExplorerTxUrl("0xabc")).toBe("https://monadscan.com/tx/0xabc");
    expect(monadExplorerTxUrl("0xabc", MONAD_MAINNET_CHAIN_ID)).toBe(
      "https://monadscan.com/tx/0xabc",
    );
    expect(monadExplorerTxUrl("0xabc", MONAD_TESTNET_CHAIN_ID)).toBe(
      "https://testnet.monadscan.com/tx/0xabc",
    );
  });

  it("treats missing/zero checkpoint as not configured (fail closed)", () => {
    expect(isCheckpointConfigured("0x0000000000000000000000000000000000000000")).toBe(
      false,
    );
    expect(isCheckpointConfigured("")).toBe(false);
    expect(
      isCheckpointConfigured("0x1111111111111111111111111111111111111111"),
    ).toBe(true);
    // Default env in tests is unset → zero address
    expect(CHECKPOINT_ADDRESS.toLowerCase()).toBe(
      "0x0000000000000000000000000000000000000000",
    );
    expect(isCheckpointConfigured()).toBe(false);
  });
});
