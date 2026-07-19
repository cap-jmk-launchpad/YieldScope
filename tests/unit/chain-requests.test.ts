import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();
const isAdminConfigured = vi.fn(() => true);

vi.mock("../../web/src/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from }),
  isAdminConfigured: () => isAdminConfigured(),
}));

vi.mock("../../web/src/lib/ledger-db", () => ({
  ensureProfileId: vi.fn(async () => "profile-1"),
}));

describe("chain-requests validation", () => {
  const original = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...original };
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
    isAdminConfigured.mockReturnValue(true);
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("rejects missing body and empty chain name", async () => {
    const { validateChainRequestPayload } = await import(
      "../../web/src/lib/chain-requests"
    );
    expect(validateChainRequestPayload(null).ok).toBe(false);
    expect(validateChainRequestPayload({}).ok).toBe(false);
    expect(validateChainRequestPayload({ chainName: "   " }).ok).toBe(false);
  });

  it("rejects overlong chain name and why", async () => {
    const { validateChainRequestPayload } = await import(
      "../../web/src/lib/chain-requests"
    );
    expect(
      validateChainRequestPayload({ chainName: "x".repeat(121) }).ok,
    ).toBe(false);
    expect(
      validateChainRequestPayload({
        chainName: "Base",
        why: "y".repeat(1001),
      }).ok,
    ).toBe(false);
  });

  it("rejects invalid contact email", async () => {
    const { validateChainRequestPayload } = await import(
      "../../web/src/lib/chain-requests"
    );
    const bad = validateChainRequestPayload({
      chainName: "Base",
      contactEmail: "not-an-email",
    });
    expect(bad.ok).toBe(false);
  });

  it("accepts chain name with optional why and email aliases", async () => {
    const { validateChainRequestPayload } = await import(
      "../../web/src/lib/chain-requests"
    );
    const ok = validateChainRequestPayload({
      chain_name: "  Ethereum  ",
      earn_type: " Lido staking ",
      contact_email: "User@Example.COM",
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.data.chainName).toBe("Ethereum");
    expect(ok.data.why).toBe("Lido staking");
    expect(ok.data.contactEmail).toBe("user@example.com");
  });

  it("accepts chain name only", async () => {
    const { validateChainRequestPayload } = await import(
      "../../web/src/lib/chain-requests"
    );
    const ok = validateChainRequestPayload({ chainName: "Solana" });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.data).toEqual({
      chainName: "Solana",
      why: null,
      contactEmail: null,
    });
  });

  it("insertChainRequest fails closed when admin is missing", async () => {
    isAdminConfigured.mockReturnValue(false);
    const { insertChainRequest, ChainRequestError } = await import(
      "../../web/src/lib/chain-requests"
    );
    await expect(
      insertChainRequest({
        userId: "u1",
        email: "a@b.co",
        chainName: "Base",
        why: null,
        contactEmail: null,
      }),
    ).rejects.toBeInstanceOf(ChainRequestError);
  });

  it("insertChainRequest persists via admin client", async () => {
    const insert = vi.fn(() => ({
      select: () => ({
        single: async () => ({ data: { id: "req-1" }, error: null }),
      }),
    }));
    from.mockImplementation((table: string) => {
      if (table === "chain_requests") {
        return { insert };
      }
      return {};
    });

    const { insertChainRequest } = await import(
      "../../web/src/lib/chain-requests"
    );
    const result = await insertChainRequest({
      userId: "u1",
      email: "user@example.com",
      chainName: "Base",
      why: "earn",
      contactEmail: null,
    });
    expect(result).toEqual({ id: "req-1" });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "u1",
        profile_id: "profile-1",
        chain_name: "Base",
        why: "earn",
        contact_email: "user@example.com",
      }),
    );
  });
});
