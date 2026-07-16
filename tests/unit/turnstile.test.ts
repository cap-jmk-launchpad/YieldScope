import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("verifyTurnstile", () => {
  const original = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...original };
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  });

  afterEach(() => {
    process.env = { ...original };
    vi.unstubAllGlobals();
  });

  it("allows when Turnstile is not configured (local/dev)", async () => {
    const { verifyTurnstile } = await import("../../web/src/lib/auth/turnstile");
    await expect(verifyTurnstile(null)).resolves.toEqual({ ok: true });
  });

  it("fails closed when site key set but secret missing", async () => {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "site";
    const { verifyTurnstile } = await import("../../web/src/lib/auth/turnstile");
    const result = await verifyTurnstile("tok");
    expect(result.ok).toBe(false);
  });

  it("rejects missing token when secret configured", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret";
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "site";
    const { verifyTurnstile } = await import("../../web/src/lib/auth/turnstile");
    const result = await verifyTurnstile(undefined);
    expect(result.ok).toBe(false);
  });

  it("accepts a verified token", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret";
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "site";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      }),
    );
    const { verifyTurnstile } = await import("../../web/src/lib/auth/turnstile");
    await expect(verifyTurnstile("good-token")).resolves.toEqual({ ok: true });
  });

  it("rejects when siteverify HTTP fails", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret";
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "site";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false }),
    );
    const { verifyTurnstile } = await import("../../web/src/lib/auth/turnstile");
    const result = await verifyTurnstile("tok");
    expect(result.ok).toBe(false);
  });

  it("rejects when siteverify returns success false", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret";
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "site";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: false }),
      }),
    );
    const { verifyTurnstile } = await import("../../web/src/lib/auth/turnstile");
    const result = await verifyTurnstile("tok");
    expect(result.ok).toBe(false);
  });
});
