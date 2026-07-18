import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("requireUser", () => {
  const original = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...original };
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("returns 401 when Supabase is not configured", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const { requireUser } = await import("../../web/src/lib/auth/require-user");
    const result = await requireUser();
    expect(result.error).toBeDefined();
    expect(result.error!.status).toBe(401);
    const body = await result.error!.json();
    expect(body.error).toMatch(/Sign-in isn’t available/i);
  });

  it("returns user when session is valid", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    vi.doMock("../../web/src/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: {
          getUser: async () => ({
            data: { user: { id: "u1", email: "a@b.c" } },
            error: null,
          }),
        },
      }),
    }));
    vi.resetModules();
    const { requireUser } = await import("../../web/src/lib/auth/require-user");
    const result = await requireUser();
    expect(result.user).toEqual({ id: "u1", email: "a@b.c" });
  });

  it("returns 401 when getUser fails", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    vi.doMock("../../web/src/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: {
          getUser: async () => ({
            data: { user: null },
            error: { message: "nope" },
          }),
        },
      }),
    }));
    vi.resetModules();
    const { requireUser } = await import("../../web/src/lib/auth/require-user");
    const result = await requireUser();
    expect(result.error?.status).toBe(401);
  });

  it("returns 401 when createClient throws", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    vi.doMock("../../web/src/lib/supabase/server", () => ({
      createClient: async () => {
        throw new Error("boom");
      },
    }));
    vi.resetModules();
    const { requireUser } = await import("../../web/src/lib/auth/require-user");
    const result = await requireUser();
    expect(result.error?.status).toBe(401);
  });
});
