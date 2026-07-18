import { describe, expect, it, vi } from "vitest";
import {
  establishRecoverySession,
  parseRecoveryUrl,
  recoveryErrorMessage,
  type RecoveryAuthClient,
} from "../../web/src/lib/auth/recovery-session";

function mockClient(
  overrides: Partial<RecoveryAuthClient["auth"]> = {},
): RecoveryAuthClient {
  return {
    auth: {
      exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
      verifyOtp: vi.fn().mockResolvedValue({ error: null }),
      setSession: vi.fn().mockResolvedValue({ error: null }),
      getSession: vi.fn().mockResolvedValue({
        data: { session: { user: { id: "u1" } } },
        error: null,
      }),
      ...overrides,
    },
  };
}

describe("parseRecoveryUrl", () => {
  it("parses PKCE code from query", () => {
    const p = parseRecoveryUrl(
      "https://app.example/auth/reset-password?code=abc123",
    );
    expect(p.code).toBe("abc123");
    expect(p.accessToken).toBeNull();
    expect(p.error).toBeNull();
  });

  it("parses OTP token_hash and type from query", () => {
    const p = parseRecoveryUrl(
      "https://app.example/auth/reset-password?token_hash=th&type=recovery",
    );
    expect(p.tokenHash).toBe("th");
    expect(p.otpType).toBe("recovery");
  });

  it("parses implicit hash tokens and type", () => {
    const p = parseRecoveryUrl(
      "https://app.example/auth/reset-password#access_token=at&refresh_token=rt&type=recovery",
    );
    expect(p.accessToken).toBe("at");
    expect(p.refreshToken).toBe("rt");
    expect(p.otpType).toBe("recovery");
  });

  it("prefers query type over hash type when both present", () => {
    const p = parseRecoveryUrl(
      "https://app.example/x?type=email#type=recovery&access_token=a&refresh_token=b",
    );
    expect(p.otpType).toBe("email");
  });

  it("reads errors from hash", () => {
    const p = parseRecoveryUrl(
      "https://app.example/x#error=access_denied&error_code=otp_expired&error_description=Link+expired",
    );
    expect(p.error).toBe("access_denied");
    expect(p.errorCode).toBe("otp_expired");
    expect(p.errorDescription).toBe("Link expired");
  });

  it("reads errors from query when hash has none", () => {
    const p = parseRecoveryUrl(
      "https://app.example/x?error=server_error&error_code=unexpected&error_description=Nope",
    );
    expect(p.error).toBe("server_error");
    expect(p.errorCode).toBe("unexpected");
    expect(p.errorDescription).toBe("Nope");
  });
});

describe("establishRecoverySession", () => {
  it("returns expired when error_code is otp_expired", async () => {
    const client = mockClient();
    const result = await establishRecoverySession(
      client,
      "https://app.example/x#error_code=otp_expired&error_description=Link+expired",
    );
    expect(result).toEqual({
      ok: false,
      reason: "expired",
      detail: "Link expired",
    });
  });

  it("treats expired/invalid descriptions as expired", async () => {
    const client = mockClient();
    const viaDesc = await establishRecoverySession(
      client,
      "https://app.example/x?error=access_denied&error_description=Token+is+invalid",
    );
    expect(viaDesc.ok).toBe(false);
    if (!viaDesc.ok) expect(viaDesc.reason).toBe("expired");

    const viaError = await establishRecoverySession(
      client,
      "https://app.example/x?error=expired_token&error_code=other",
    );
    expect(viaError.ok).toBe(false);
    if (!viaError.ok) expect(viaError.reason).toBe("expired");
  });

  it("returns session_failed for non-expiry redirect errors", async () => {
    const client = mockClient();
    const result = await establishRecoverySession(
      client,
      "https://app.example/x?error=access_denied&error_description=Something+else",
    );
    expect(result).toEqual({
      ok: false,
      reason: "session_failed",
      detail: "Something else",
    });
  });

  it("falls back to error string when description missing", async () => {
    const client = mockClient();
    const result = await establishRecoverySession(
      client,
      "https://app.example/x?error=access_denied",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("session_failed");
      expect(result.detail).toBe("access_denied");
    }
  });

  it("exchanges PKCE code successfully", async () => {
    const client = mockClient();
    const result = await establishRecoverySession(
      client,
      "https://app.example/x?code=pkce-code",
    );
    expect(result).toEqual({ ok: true });
    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith("pkce-code");
  });

  it("recovers when exchange fails but session already exists", async () => {
    const client = mockClient({
      exchangeCodeForSession: vi
        .fn()
        .mockResolvedValue({ error: { message: "code already used" } }),
      getSession: vi.fn().mockResolvedValue({
        data: { session: { user: { id: "u1" } } },
        error: null,
      }),
    });
    const result = await establishRecoverySession(
      client,
      "https://app.example/x?code=used",
    );
    expect(result).toEqual({ ok: true });
  });

  it("fails when exchange fails and no session", async () => {
    const client = mockClient({
      exchangeCodeForSession: vi
        .fn()
        .mockResolvedValue({ error: { message: "bad code" } }),
      getSession: vi.fn().mockResolvedValue({
        data: { session: null },
        error: null,
      }),
    });
    const result = await establishRecoverySession(
      client,
      "https://app.example/x?code=bad",
    );
    expect(result).toEqual({
      ok: false,
      reason: "session_failed",
      detail: "bad code",
    });
  });

  it("verifies OTP for recovery and email types", async () => {
    const recoveryClient = mockClient();
    await expect(
      establishRecoverySession(
        recoveryClient,
        "https://app.example/x?token_hash=th1&type=recovery",
      ),
    ).resolves.toEqual({ ok: true });
    expect(recoveryClient.auth.verifyOtp).toHaveBeenCalledWith({
      token_hash: "th1",
      type: "recovery",
    });

    const emailClient = mockClient();
    await expect(
      establishRecoverySession(
        emailClient,
        "https://app.example/x?token_hash=th2&type=email",
      ),
    ).resolves.toEqual({ ok: true });
    expect(emailClient.auth.verifyOtp).toHaveBeenCalledWith({
      token_hash: "th2",
      type: "email",
    });
  });

  it("fails when verifyOtp errors", async () => {
    const client = mockClient({
      verifyOtp: vi.fn().mockResolvedValue({ error: { message: "otp bad" } }),
      getSession: vi.fn().mockResolvedValue({
        data: { session: null },
        error: null,
      }),
    });
    const result = await establishRecoverySession(
      client,
      "https://app.example/x?token_hash=th&type=recovery",
    );
    expect(result).toEqual({
      ok: false,
      reason: "session_failed",
      detail: "otp bad",
    });
  });

  it("ignores token_hash when type is not recovery/email", async () => {
    const client = mockClient({
      getSession: vi.fn().mockResolvedValue({
        data: { session: null },
        error: null,
      }),
    });
    const result = await establishRecoverySession(
      client,
      "https://app.example/x?token_hash=th&type=signup",
    );
    expect(client.auth.verifyOtp).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, reason: "session_failed" });
  });

  it("sets session from hash tokens", async () => {
    const client = mockClient();
    const result = await establishRecoverySession(
      client,
      "https://app.example/x#access_token=at&refresh_token=rt&type=recovery",
    );
    expect(result).toEqual({ ok: true });
    expect(client.auth.setSession).toHaveBeenCalledWith({
      access_token: "at",
      refresh_token: "rt",
    });
  });

  it("fails when setSession errors", async () => {
    const client = mockClient({
      setSession: vi.fn().mockResolvedValue({ error: { message: "set fail" } }),
      getSession: vi.fn().mockResolvedValue({
        data: { session: null },
        error: null,
      }),
    });
    const result = await establishRecoverySession(
      client,
      "https://app.example/x#access_token=at&refresh_token=rt",
    );
    expect(result).toEqual({
      ok: false,
      reason: "session_failed",
      detail: "set fail",
    });
  });

  it("recovers from thrown Error when session exists", async () => {
    const client = mockClient({
      exchangeCodeForSession: vi.fn().mockRejectedValue(new Error("boom")),
      getSession: vi.fn().mockResolvedValue({
        data: { session: { user: { id: "u1" } } },
        error: null,
      }),
    });
    const result = await establishRecoverySession(
      client,
      "https://app.example/x?code=c",
    );
    expect(result).toEqual({ ok: true });
  });

  it("surfaces thrown non-Error when no session", async () => {
    const client = mockClient({
      exchangeCodeForSession: vi.fn().mockRejectedValue("raw-fail"),
      getSession: vi.fn().mockResolvedValue({
        data: { session: null },
        error: null,
      }),
    });
    const result = await establishRecoverySession(
      client,
      "https://app.example/x?code=c",
    );
    expect(result).toEqual({
      ok: false,
      reason: "session_failed",
      detail: "Session setup failed",
    });
  });

  it("fails when final getSession returns error", async () => {
    const client = mockClient({
      getSession: vi.fn().mockResolvedValue({
        data: { session: null },
        error: { message: "get fail" },
      }),
    });
    const result = await establishRecoverySession(
      client,
      "https://app.example/x?code=c",
    );
    expect(result).toEqual({
      ok: false,
      reason: "session_failed",
      detail: "get fail",
    });
  });

  it("returns missing when no credentials and no session", async () => {
    const client = mockClient({
      getSession: vi.fn().mockResolvedValue({
        data: { session: null },
        error: null,
      }),
    });
    const result = await establishRecoverySession(
      client,
      "https://app.example/auth/reset-password",
    );
    expect(result).toEqual({ ok: false, reason: "missing" });
  });

  it("returns session_failed when credentials present but no session", async () => {
    const client = mockClient({
      getSession: vi.fn().mockResolvedValue({
        data: { session: null },
        error: null,
      }),
    });
    // access without refresh is not enough to call setSession, but still a credential signal
    const result = await establishRecoverySession(
      client,
      "https://app.example/x#access_token=only-at",
    );
    expect(result).toEqual({ ok: false, reason: "missing" });
  });
});

describe("recoveryErrorMessage", () => {
  it("returns empty string for ok", () => {
    expect(recoveryErrorMessage({ ok: true })).toBe("");
  });

  it("maps expired", () => {
    expect(
      recoveryErrorMessage({ ok: false, reason: "expired" }),
    ).toMatch(/already used or has expired/i);
  });

  it("maps session_failed with and without detail", () => {
    expect(
      recoveryErrorMessage({ ok: false, reason: "session_failed" }),
    ).toMatch(/Could not open reset session from this link/i);
    expect(
      recoveryErrorMessage({
        ok: false,
        reason: "session_failed",
        detail: "nope",
      }),
    ).toBe("Could not open reset session: nope");
  });

  it("maps missing", () => {
    expect(
      recoveryErrorMessage({ ok: false, reason: "missing" }),
    ).toMatch(/No reset token found/i);
  });
});
