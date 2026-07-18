import { describe, expect, it } from "vitest";
import {
  authCallbackRedirect,
  authRecoveryRedirect,
  safeRedirectPath,
} from "../../web/src/lib/auth/redirect";

describe("safeRedirectPath", () => {
  it("returns fallback for null or empty", () => {
    expect(safeRedirectPath(null)).toBe("/app");
    expect(safeRedirectPath("")).toBe("/app");
  });

  it("rejects protocol-relative and absolute URLs", () => {
    expect(safeRedirectPath("//evil.com")).toBe("/app");
    expect(safeRedirectPath("https://evil.com")).toBe("/app");
  });

  it("allows same-origin relative paths", () => {
    expect(safeRedirectPath("/app/connect")).toBe("/app/connect");
    expect(safeRedirectPath("/auth/reset-password")).toBe("/auth/reset-password");
  });
});

describe("authCallbackRedirect", () => {
  it("builds callback URL with encoded next path", () => {
    expect(
      authCallbackRedirect("/auth/reset-password", "http://localhost:3000"),
    ).toBe(
      "http://localhost:3000/auth/callback?next=%2Fauth%2Freset-password",
    );
  });

  it("sanitizes unsafe next paths", () => {
    expect(
      authCallbackRedirect("//evil.com", "https://yieldscope.d3bu7.com"),
    ).toBe("https://yieldscope.d3bu7.com/auth/callback?next=%2Fapp");
  });
});

describe("authRecoveryRedirect", () => {
  it("returns path-only reset-password URL", () => {
    expect(authRecoveryRedirect("https://yieldscope.d3bu7.com")).toBe(
      "https://yieldscope.d3bu7.com/auth/reset-password",
    );
  });
});
