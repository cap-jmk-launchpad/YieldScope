import { describe, expect, it } from "vitest";
import {
  authCallbackErrorMessage,
  isEmailNotConfirmed,
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
