import { describe, expect, it } from "vitest";
import {
  RAINBOWKIT_DEMO_PROJECT_ID,
  YIELDSCOPE_WALLET_GROUP_IDS,
  isDemoWalletConnectProjectId,
  preferInBrowserDownloadUrls,
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

describe("in-browser wallet preference", () => {
  it("lists Phantom + injected before WalletConnect, in separate groups", () => {
    expect(YIELDSCOPE_WALLET_GROUP_IDS).toEqual([
      {
        groupName: "This browser",
        walletIds: ["phantom", "injected", "metaMask", "okx"],
      },
      {
        groupName: "Phone (QR)",
        walletIds: ["walletConnect"],
      },
    ]);
    const browserIds = YIELDSCOPE_WALLET_GROUP_IDS[0].walletIds;
    expect(browserIds[0]).toBe("phantom");
    expect(browserIds).not.toContain("walletConnect");
    expect(browserIds).not.toContain("rainbow");
  });

  it("strips mobile / protocol-handoff download URLs, keeps extension store links", () => {
    expect(
      preferInBrowserDownloadUrls({
        android: "https://play.google.com/store/apps/details?id=app.phantom",
        ios: "https://apps.apple.com/app/phantom",
        mobile: "https://phantom.app/download",
        qrCode: "https://phantom.app/download",
        browserExtension: "https://phantom.app/download",
        chrome:
          "https://chrome.google.com/webstore/detail/phantom/bfnaelmomeimhlpmgjnjophhpkkoljpa",
        firefox: "https://addons.mozilla.org/firefox/addon/phantom-app/",
      }),
    ).toEqual({
      chrome:
        "https://chrome.google.com/webstore/detail/phantom/bfnaelmomeimhlpmgjnjophhpkkoljpa",
      firefox: "https://addons.mozilla.org/firefox/addon/phantom-app/",
    });
    expect(preferInBrowserDownloadUrls(undefined)).toEqual({
      chrome: undefined,
      firefox: undefined,
    });
  });
});
