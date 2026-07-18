import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();
const isAdminConfigured = vi.fn(() => true);

vi.mock("../../web/src/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from }),
  isAdminConfigured: () => isAdminConfigured(),
}));

const WALLET = "0x1111111111111111111111111111111111111111";

function mockNoWallet() {
  return {
    select: () => ({
      eq: () => ({
        order: () => ({
          limit: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    }),
  };
}

function mockWalletRow(address = WALLET) {
  return {
    select: () => ({
      eq: () => ({
        order: () => ({
          limit: () => ({
            maybeSingle: async () => ({
              data: {
                address,
                chain_id: 10143,
                last_seen_at: "2026-07-18T00:00:00.000Z",
              },
              error: null,
            }),
          }),
        }),
      }),
    }),
    upsert: async () => ({ error: null }),
  };
}

describe("credentials-db persistence", () => {
  const original = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...original };
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    isAdminConfigured.mockReturnValue(true);
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("validateSavePayload rejects incomplete Binance and OKX", async () => {
    const { validateSavePayload } = await import(
      "../../web/src/lib/credentials-db"
    );
    expect(
      validateSavePayload({ binance: { apiKey: "only-key", apiSecret: "" } })
        .ok,
    ).toBe(false);
    expect(
      validateSavePayload({
        okx: { apiKey: "k", apiSecret: "s", passphrase: "" },
      }).ok,
    ).toBe(false);
  });

  it("validateSavePayload accepts Binance, OKX, LUNC, and wallet", async () => {
    const { validateSavePayload } = await import(
      "../../web/src/lib/credentials-db"
    );
    expect(
      validateSavePayload({ binance: { apiKey: "k", apiSecret: "s" } }).ok,
    ).toBe(true);
    expect(
      validateSavePayload({
        okx: { apiKey: "k", apiSecret: "s", passphrase: "p" },
      }).ok,
    ).toBe(true);
    expect(validateSavePayload({ luncAddress: " terra1abc " }).ok).toBe(true);
    const wallet = validateSavePayload({ walletAddress: WALLET, chainId: 10143 });
    expect(wallet.ok).toBe(true);
    if (wallet.ok) {
      expect(wallet.data.walletAddress).toBe(WALLET.toLowerCase());
    }
  });

  it("validateSavePayload rejects invalid wallet and empty payload", async () => {
    const { validateSavePayload } = await import(
      "../../web/src/lib/credentials-db"
    );
    expect(validateSavePayload({ walletAddress: "not-an-address" }).ok).toBe(
      false,
    );
    expect(validateSavePayload({}).ok).toBe(false);
  });

  it("summarizeSavedSources names Binance, OKX, and wallet", async () => {
    const { summarizeSavedSources } = await import(
      "../../web/src/lib/credentials-db"
    );
    expect(
      summarizeSavedSources({
        binance: { configured: true, keyHint: "••••abcd" },
        okx: { configured: true, keyHint: "••••efgh" },
        monad_stake: { configured: true, keyHint: "0x1111…1111" },
        lunc_stake: { configured: false },
      }),
    ).toMatch(/Binance.*OKX.*Monad wallet.*saved successfully/);
  });

  it("saveCredentials persists encrypted Binance and returns status", async () => {
    const upsert = vi.fn(async () => ({ error: null }));
    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "p1" }, error: null }),
            }),
          }),
        };
      }
      if (table === "source_credentials") {
        return {
          upsert,
          select: () => ({
            eq: async () => ({
              data: [
                {
                  source: "binance",
                  key_hint: "••••mnop",
                  updated_at: "2026-07-18T00:00:00.000Z",
                },
              ],
              error: null,
            }),
          }),
        };
      }
      if (table === "wallet_connections") return mockNoWallet();
      return {};
    });

    const { saveCredentials } = await import(
      "../../web/src/lib/credentials-db"
    );
    const status = await saveCredentials({
      userId: "u1",
      email: "a@b.c",
      binance: { apiKey: "abcdefghijklmnop", apiSecret: "secret" },
    });

    expect(upsert).toHaveBeenCalled();
    const rows = upsert.mock.calls[0][0] as Array<{
      source: string;
      ciphertext: string;
      key_hint: string;
    }>;
    expect(rows[0].source).toBe("binance");
    expect(rows[0].ciphertext).not.toContain("secret");
    expect(rows[0].key_hint).toBe("••••mnop");
    expect(status.binance.configured).toBe(true);
  });

  it("saveCredentials persists OKX encrypted and wallet connection", async () => {
    const credUpsert = vi.fn(async () => ({ error: null }));
    const walletUpsert = vi.fn(async () => ({ error: null }));
    const profileUpdate = vi.fn(() => ({
      eq: async () => ({ error: null }),
    }));

    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "p1" }, error: null }),
            }),
          }),
          update: profileUpdate,
        };
      }
      if (table === "source_credentials") {
        return {
          upsert: credUpsert,
          select: () => ({
            eq: async () => ({
              data: [
                {
                  source: "okx",
                  key_hint: "••••mnop",
                  updated_at: "2026-07-18T00:00:00.000Z",
                },
              ],
              error: null,
            }),
          }),
        };
      }
      if (table === "wallet_connections") {
        return {
          upsert: walletUpsert,
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: {
                      address: WALLET,
                      chain_id: 10143,
                      last_seen_at: "2026-07-18T00:00:00.000Z",
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });

    const { saveCredentials } = await import(
      "../../web/src/lib/credentials-db"
    );
    const status = await saveCredentials({
      userId: "u1",
      okx: {
        apiKey: "abcdefghijklmnop",
        apiSecret: "os",
        passphrase: "op",
      },
      walletAddress: WALLET,
      chainId: 10143,
    });

    expect(credUpsert).toHaveBeenCalled();
    expect(walletUpsert).toHaveBeenCalled();
    expect(profileUpdate).toHaveBeenCalled();
    expect(status.okx.configured).toBe(true);
    expect(status.monad_stake.configured).toBe(true);
    expect(status.monad_stake.keyHint).toMatch(/^0x1111/);
  });

  it("saveCredentials wallet-only skips source_credentials upsert", async () => {
    const credUpsert = vi.fn(async () => ({ error: null }));
    const walletUpsert = vi.fn(async () => ({ error: null }));

    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "p1" }, error: null }),
            }),
          }),
          update: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      }
      if (table === "source_credentials") {
        return {
          upsert: credUpsert,
          select: () => ({
            eq: async () => ({ data: [], error: null }),
          }),
        };
      }
      if (table === "wallet_connections") {
        return {
          upsert: walletUpsert,
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: {
                      address: WALLET,
                      chain_id: 10143,
                      last_seen_at: "2026-07-18T00:00:00.000Z",
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });

    const { saveCredentials } = await import(
      "../../web/src/lib/credentials-db"
    );
    const status = await saveCredentials({
      userId: "u1",
      walletAddress: WALLET,
    });
    expect(credUpsert).not.toHaveBeenCalled();
    expect(walletUpsert).toHaveBeenCalled();
    expect(status.monad_stake.configured).toBe(true);
  });

  it("saveCredentials fails closed when admin not configured", async () => {
    isAdminConfigured.mockReturnValue(false);
    const { saveCredentials, CredentialsError } = await import(
      "../../web/src/lib/credentials-db"
    );
    await expect(
      saveCredentials({
        userId: "u1",
        binance: { apiKey: "k", apiSecret: "s" },
      }),
    ).rejects.toBeInstanceOf(CredentialsError);
  });

  it("saveCredentials surfaces upsert and wallet failures", async () => {
    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "p1" }, error: null }),
            }),
          }),
        };
      }
      if (table === "source_credentials") {
        return {
          upsert: async () => ({ error: { message: "rls boom" } }),
        };
      }
      return {};
    });

    const { saveCredentials, CredentialsError } = await import(
      "../../web/src/lib/credentials-db"
    );
    await expect(
      saveCredentials({
        userId: "u1",
        binance: { apiKey: "k", apiSecret: "s" },
      }),
    ).rejects.toThrow(/rls boom/);

    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "p1" }, error: null }),
            }),
          }),
        };
      }
      if (table === "wallet_connections") {
        return {
          upsert: async () => ({ error: { message: "wallet boom" } }),
        };
      }
      return {};
    });
    await expect(
      saveCredentials({ userId: "u1", walletAddress: WALLET }),
    ).rejects.toBeInstanceOf(CredentialsError);
  });

  it("loadCredentialsStatus returns empty when no profile", async () => {
    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      return {};
    });

    const { loadCredentialsStatus } = await import(
      "../../web/src/lib/credentials-db"
    );
    const status = await loadCredentialsStatus("u1");
    expect(status.binance.configured).toBe(false);
    expect(status.okx.configured).toBe(false);
    expect(status.monad_stake.configured).toBe(false);
  });

  it("loadCredentialsStatus fails on profile or select errors", async () => {
    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: null,
                error: { message: "profile boom" },
              }),
            }),
          }),
        };
      }
      return {};
    });
    const { loadCredentialsStatus, CredentialsError } = await import(
      "../../web/src/lib/credentials-db"
    );
    await expect(loadCredentialsStatus("u1")).rejects.toBeInstanceOf(
      CredentialsError,
    );

    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "p1" }, error: null }),
            }),
          }),
        };
      }
      if (table === "source_credentials") {
        return {
          select: () => ({
            eq: async () => ({
              data: null,
              error: { message: "select boom" },
            }),
          }),
        };
      }
      if (table === "wallet_connections") return mockNoWallet();
      return {};
    });
    await expect(loadCredentialsStatus("u1")).rejects.toThrow(/select boom/);
  });

  it("loadBinanceCredentials decrypts stored ciphertext", async () => {
    const { encryptSecret } = await import(
      "../../web/src/lib/credentials-crypto"
    );
    const ciphertext = encryptSecret(
      JSON.stringify({ apiKey: "k", apiSecret: "s" }),
      "service-role-test-key",
    );

    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "p1" }, error: null }),
            }),
          }),
        };
      }
      if (table === "source_credentials") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { ciphertext },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });

    const { loadBinanceCredentials } = await import(
      "../../web/src/lib/credentials-db"
    );
    expect(await loadBinanceCredentials("u1")).toEqual({
      apiKey: "k",
      apiSecret: "s",
    });
  });

  it("loadOkxCredentials and loadLuncAddress round-trip", async () => {
    const { encryptSecret } = await import(
      "../../web/src/lib/credentials-crypto"
    );
    const okxCipher = encryptSecret(
      JSON.stringify({
        apiKey: "ok",
        apiSecret: "os",
        passphrase: "op",
      }),
      "service-role-test-key",
    );
    const luncCipher = encryptSecret(
      JSON.stringify({ address: "terra1abc" }),
      "service-role-test-key",
    );

    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "p1" }, error: null }),
            }),
          }),
        };
      }
      if (table === "source_credentials") {
        return {
          select: () => ({
            eq: (_col: string, val: string) => {
              if (val === "p1") {
                return {
                  eq: (_c2: string, source: string) => ({
                    maybeSingle: async () => ({
                      data: {
                        ciphertext: source === "okx" ? okxCipher : luncCipher,
                      },
                      error: null,
                    }),
                  }),
                };
              }
              return {
                eq: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              };
            },
          }),
        };
      }
      return {};
    });

    const { loadOkxCredentials, loadLuncAddress } = await import(
      "../../web/src/lib/credentials-db"
    );
    expect(await loadOkxCredentials("u1")).toEqual({
      apiKey: "ok",
      apiSecret: "os",
      passphrase: "op",
    });
    expect(await loadLuncAddress("u1")).toBe("terra1abc");
  });

  it("loadMonadWalletAddress returns saved wallet", async () => {
    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "p1" }, error: null }),
            }),
          }),
        };
      }
      if (table === "wallet_connections") return mockWalletRow();
      return {};
    });
    const { loadMonadWalletAddress } = await import(
      "../../web/src/lib/credentials-db"
    );
    expect(await loadMonadWalletAddress("u1")).toBe(WALLET);
  });

  it("loadDecrypted throws on corrupt ciphertext", async () => {
    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "p1" }, error: null }),
            }),
          }),
        };
      }
      if (table === "source_credentials") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { ciphertext: "not-valid-cipher" },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });

    const { loadBinanceCredentials, CredentialsError } = await import(
      "../../web/src/lib/credentials-db"
    );
    await expect(loadBinanceCredentials("u1")).rejects.toBeInstanceOf(
      CredentialsError,
    );
  });

  it("maskWalletAddress hides middle of address", async () => {
    const { maskWalletAddress } = await import(
      "../../web/src/lib/credentials-db"
    );
    expect(maskWalletAddress(WALLET)).toBe("0x1111…1111");
    expect(maskWalletAddress("0xabc")).toBe("••••");
  });

  it("covers status/save/load edge paths for 100% backend-ops", async () => {
    const { encryptSecret, resolveCredentialsKeyMaterial } = await import(
      "../../web/src/lib/credentials-crypto"
    );
    const {
      loadCredentialsStatus,
      saveCredentials,
      loadBinanceCredentials,
      loadOkxCredentials,
      loadLuncAddress,
      loadMonadWalletAddress,
      CredentialsError,
      summarizeSavedSources,
    } = await import("../../web/src/lib/credentials-db");

    isAdminConfigured.mockReturnValue(false);
    await expect(loadCredentialsStatus("u1")).rejects.toThrow(/not configured/);
    isAdminConfigured.mockReturnValue(true);

    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "p1" }, error: null }),
            }),
          }),
          update: () => ({
            eq: async () => ({ error: { message: "profile wallet boom" } }),
          }),
        };
      }
      if (table === "source_credentials") {
        return {
          select: () => ({
            eq: async () => ({
              data: [
                {
                  source: "lunc_stake",
                  key_hint: null,
                  updated_at: null,
                },
                { source: "unknown_src", key_hint: "x", updated_at: "t" },
              ],
              error: null,
            }),
          }),
          upsert: async () => ({ error: null }),
        };
      }
      if (table === "wallet_connections") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: null,
                    error: { message: "wallet load boom" },
                  }),
                }),
              }),
            }),
          }),
          upsert: async () => ({ error: null }),
        };
      }
      return {};
    });
    await expect(loadCredentialsStatus("u1")).rejects.toThrow(
      /Failed loading wallet/,
    );

    await expect(
      saveCredentials({
        userId: "u1",
        binance: { apiKey: "only-key", apiSecret: "" },
      }),
    ).rejects.toBeInstanceOf(CredentialsError);

    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "p1" }, error: null }),
            }),
          }),
          update: () => ({
            eq: async () => ({ error: { message: "profile wallet boom" } }),
          }),
        };
      }
      if (table === "source_credentials") {
        return {
          upsert: async () => ({ error: null }),
          select: () => ({
            eq: async () => ({ data: [], error: null }),
          }),
        };
      }
      if (table === "wallet_connections") {
        return {
          upsert: async () => ({ error: null }),
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });
    await expect(
      saveCredentials({
        userId: "u1",
        luncAddress: "terra1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a",
        walletAddress: WALLET,
      }),
    ).rejects.toThrow(/profile wallet/);

    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "p1" }, error: null }),
            }),
          }),
          update: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      }
      if (table === "source_credentials") {
        return {
          upsert: async () => ({ error: null }),
          select: () => ({
            eq: async () => ({
              data: [
                {
                  source: "lunc_stake",
                  key_hint: "terra1…ql8a",
                  updated_at: "2026-07-18T00:00:00.000Z",
                },
              ],
              error: null,
            }),
          }),
        };
      }
      if (table === "wallet_connections") {
        return mockNoWallet();
      }
      return {};
    });
    const status = await saveCredentials({
      userId: "u1",
      luncAddress: "terra1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a",
    });
    expect(status.lunc_stake.configured).toBe(true);
    expect(
      summarizeSavedSources({
        binance: { configured: false },
        okx: { configured: false },
        monad_stake: { configured: false },
        lunc_stake: { configured: true },
      }),
    ).toMatch(/LUNC address saved/);

    isAdminConfigured.mockReturnValue(false);
    expect(await loadBinanceCredentials("u1")).toBeNull();
    expect(await loadMonadWalletAddress("u1")).toBeNull();
    isAdminConfigured.mockReturnValue(true);

    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      return {};
    });
    expect(await loadBinanceCredentials("u1")).toBeNull();
    expect(await loadLuncAddress("u1")).toBeNull();
    expect(await loadMonadWalletAddress("u1")).toBeNull();

    const keyMat = resolveCredentialsKeyMaterial();
    const okxCipher = encryptSecret(
      JSON.stringify({ apiKey: "k", apiSecret: "s", passphrase: "p" }),
      keyMat,
    );
    const emptyLunc = encryptSecret(JSON.stringify({ address: "" }), keyMat);

    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "p1" }, error: null }),
            }),
          }),
        };
      }
      if (table === "source_credentials") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { ciphertext: okxCipher },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });
    expect(await loadBinanceCredentials("u1")).toBeNull();
    expect(await loadOkxCredentials("u1")).toEqual({
      apiKey: "k",
      apiSecret: "s",
      passphrase: "p",
    });

    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "p1" }, error: null }),
            }),
          }),
        };
      }
      if (table === "source_credentials") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { ciphertext: emptyLunc },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });
    expect(await loadLuncAddress("u1")).toBeNull();

    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "p1" }, error: null }),
            }),
          }),
        };
      }
      if (table === "source_credentials") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: null,
                  error: { message: "missing" },
                }),
              }),
            }),
          }),
        };
      }
      if (table === "wallet_connections") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: null,
                    error: { message: "w" },
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });
    expect(await loadOkxCredentials("u1")).toBeNull();
    expect(await loadMonadWalletAddress("u1")).toBeNull();

    // null key_hint / updated_at / last_seen_at + wallet without chainId
    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "p1" }, error: null }),
            }),
          }),
          update: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      }
      if (table === "source_credentials") {
        return {
          upsert: async () => ({ error: null }),
          select: () => ({
            eq: async () => ({
              data: [
                {
                  source: "binance",
                  key_hint: null,
                  updated_at: null,
                },
              ],
              error: null,
            }),
          }),
        };
      }
      if (table === "wallet_connections") {
        return {
          upsert: async () => ({ error: null }),
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: {
                      address: WALLET,
                      chain_id: 10143,
                      last_seen_at: null,
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });
    const { saveCredentials: save2, loadCredentialsStatus: load2 } =
      await import("../../web/src/lib/credentials-db");
    // wallet without chainId → save applies 10143
    await save2({ userId: "u1", walletAddress: WALLET });
    const st = await load2("u1");
    expect(st.binance.keyHint).toBe("•••• saved");
    expect(st.monad_stake.configured).toBe(true);

    // credsRes.data null
    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "p1" }, error: null }),
            }),
          }),
        };
      }
      if (table === "source_credentials") {
        return {
          select: () => ({
            eq: async () => ({
              data: [
                {
                  source: "binance",
                  key_hint: null,
                  updated_at: null,
                },
                {
                  source: "unknown_src",
                  key_hint: "x",
                  updated_at: "t",
                },
              ],
              error: null,
            }),
          }),
        };
      }
      if (table === "wallet_connections") {
        return mockNoWallet();
      }
      return {};
    });
    const empty = await load2("u1");
    expect(empty.binance.configured).toBe(true);
    expect(empty.binance.keyHint).toBe("•••• saved");

    // data null → ?? []
    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "p1" }, error: null }),
            }),
          }),
        };
      }
      if (table === "source_credentials") {
        return {
          select: () => ({
            eq: async () => ({ data: null, error: null }),
          }),
        };
      }
      if (table === "wallet_connections") {
        return mockNoWallet();
      }
      return {};
    });
    expect((await load2("u1")).binance.configured).toBe(false);
  });
});
