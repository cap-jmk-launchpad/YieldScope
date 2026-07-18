import { describe, expect, it } from "vitest";
import {
  AUTH_MAIL_FROM,
  authCallbackErrorMessage,
  emailNotConfirmedMessage,
  isEmailNotConfirmed,
  passwordResetSentMessage,
  signupConfirmationSentMessage,
} from "../../web/src/lib/auth/messages";

describe("isEmailNotConfirmed", () => {
  it("detects Supabase unconfirmed email errors", () => {
    expect(isEmailNotConfirmed("Email not confirmed")).toBe(true);
    expect(isEmailNotConfirmed("email not confirmed")).toBe(true);
  });

  it("ignores other auth errors", () => {
    expect(isEmailNotConfirmed("Invalid login credentials")).toBe(false);
  });
});

describe("authCallbackErrorMessage", () => {
  it("maps known callback error codes", () => {
    expect(authCallbackErrorMessage("auth_callback")).toMatch(/expired or invalid/i);
    expect(authCallbackErrorMessage("auth_unconfigured")).toMatch(/not configured/i);
  });

  it("returns null for unknown codes", () => {
    expect(authCallbackErrorMessage(null)).toBeNull();
    expect(authCallbackErrorMessage("other")).toBeNull();
  });
});

describe("auth mail success copy", () => {
  it("signup confirmation names sender and spam tip", () => {
    const msg = signupConfirmationSentMessage("user@example.com");
    expect(msg).toContain("user@example.com");
    expect(msg).toContain(AUTH_MAIL_FROM);
    expect(msg).toMatch(/YieldScope/);
    expect(msg).toMatch(/spam\/junk/i);
  });

  it("password reset names sender and spam tip", () => {
    const msg = passwordResetSentMessage("user@example.com");
    expect(msg).toContain("user@example.com");
    expect(msg).toContain(AUTH_MAIL_FROM);
    expect(msg).toMatch(/YieldScope/);
    expect(msg).toMatch(/spam\/junk/i);
  });

  it("unconfirmed login hints sender and spam", () => {
    const msg = emailNotConfirmedMessage();
    expect(msg).toContain(AUTH_MAIL_FROM);
    expect(msg).toMatch(/YieldScope/);
    expect(msg).toMatch(/spam\/junk/i);
  });
});
