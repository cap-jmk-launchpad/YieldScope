import { describe, expect, it } from "vitest";
import {
  RAINBOWKIT_DEMO_PROJECT_ID,
  isDemoWalletConnectProjectId,
  resolveWalletConnectProjectId,
} from "../../web/src/lib/wallet-config";

describe("resolveWalletConnectProjectId", () => {
  it("prefers a trimmed env project id", () => {
    const result = resolveWalletConnectProjectId({
      envProjectId: "  abcdef0123456789abcdef0123456789  ",
      nodeEnv: "production",
    });
    expect(result).toEqual({
      projectId: "abcdef0123456789abcdef0123456789",
      source: "env",
    });
  });

  it("uses the RainbowKit demo id in development when env is empty", () => {
    expect(
      resolveWalletConnectProjectId({
        envProjectId: "",
        nodeEnv: "development",
      }),
    ).toEqual({
      projectId: RAINBOWKIT_DEMO_PROJECT_ID,
      source: "dev-demo",
    });
  });

  it("falls back to the demo id in production so mobile WalletConnect still works", () => {
    const result = resolveWalletConnectProjectId({
      envProjectId: undefined,
      nodeEnv: "production",
    });
    expect(result.source).toBe("prod-demo-fallback");
    expect(result.projectId).toBe(RAINBOWKIT_DEMO_PROJECT_ID);
    expect(isDemoWalletConnectProjectId(result.projectId)).toBe(true);
  });

  it("treats blank env strings as missing (?? alone is not enough)", () => {
    expect(
      resolveWalletConnectProjectId({
        envProjectId: "   ",
        nodeEnv: "production",
      }).source,
    ).toBe("prod-demo-fallback");
  });
});
