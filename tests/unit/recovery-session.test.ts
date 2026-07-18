import { describe, expect, it, vi } from "vitest";
import {
  establishRecoverySession,
  parseRecoveryUrl,
  recoveryErrorMessage,
  type RecoveryAuthClient,
} from "../../web/src/lib/auth/recovery-session";

function mockClient(overrides: Partial<RecoveryAuthClient["auth"]> = {}): RecoveryAuthClient {
  return {
    auth: {
      exchangeCodeForSession: vi.fn(async () => ({ error: null })),
      verifyOtp: vi.fn(async () => ({ error: null })),
      setSession: vi.fn(async () => ({ error: null })),
      getSession: vi.fn(async () => ({
        data: { session: { user: { id: "u1" } } },
        error: null,
      })),
      ...overrides,
    },
  };
}

describe("parseRecoveryUrl", () => {
  it("reads implicit hash tokens", () => {
    const p = parseRecoveryUrl(
      "https://yieldscope.d3bu7.com/auth/reset-password#access_token=at&refresh_token=rt&type=recovery",
    );
    expect(p.accessToken).toBe("at");
    expect(p.refreshToken).toBe("rt");
    expect(p.otpType).toBe("recovery");
  });

  it("reads token_hash query (scanner-safe path)", () => {
    const p = parseRecoveryUrl(
      "https://yieldscope.d3bu7.com/auth/reset-password?token_hash=th&type=recovery",
    );
    expect(p.tokenHash).toBe("th");
    expect(p.otpType).toBe("recovery");
  });

  it("reads otp_expired hash errors", () => {
    const p = parseRecoveryUrl(
      "https://yieldscope.d3bu7.com/auth/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    );
    expect(p.errorCode).toBe("otp_expired");
    expect(p.errorDescription).toContain("invalid");
  });
});

describe("establishRecoverySession", () => {
  it("setSession from hash tokens", async () => {
    const setSession = vi.fn(async () => ({ error: null }));
    const client = mockClient({ setSession });
    const result = await establishRecoverySession(
      client,
      "https://x/auth/reset-password#access_token=at&refresh_token=rt&type=recovery",
    );
    expect(result).toEqual({ ok: true });
    expect(setSession).toHaveBeenCalledWith({
      access_token: "at",
      refresh_token: "rt",
    });
  });

  it("verifyOtp from token_hash", async () => {
    const verifyOtp = vi.fn(async () => ({ error: null }));
    const client = mockClient({ verifyOtp });
    const result = await establishRecoverySession(
      client,
      "https://x/auth/reset-password?token_hash=abc&type=recovery",
    );
    expect(result).toEqual({ ok: true });
    expect(verifyOtp).toHaveBeenCalledWith({
      token_hash: "abc",
      type: "recovery",
    });
  });

  it("falls back to getSession when PKCE code already consumed", async () => {
    const client = mockClient({
      exchangeCodeForSession: vi.fn(async () => ({
        error: { message: "invalid request: both auth code and code verifier should be non-empty" },
      })),
      getSession: vi.fn(async () => ({
        data: { session: { user: { id: "u1" } } },
        error: null,
      })),
    });
    const result = await establishRecoverySession(
      client,
      "https://x/auth/reset-password?code=used",
    );
    expect(result).toEqual({ ok: true });
  });

  it("returns expired for otp_expired hash", async () => {
    const result = await establishRecoverySession(
      mockClient(),
      "https://x/auth/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  it("returns missing when no credentials", async () => {
    const client = mockClient({
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    });
    const result = await establishRecoverySession(
      client,
      "https://x/auth/reset-password",
    );
    expect(result).toEqual({ ok: false, reason: "missing" });
  });
});

describe("recoveryErrorMessage", () => {
  it("explains scanner-consumed links", () => {
    expect(
      recoveryErrorMessage({ ok: false, reason: "expired" }),
    ).toMatch(/already used|expired/i);
  });
});
