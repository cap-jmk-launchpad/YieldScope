import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function makeReq(url: string, method = "GET") {
  const u = new URL(url);
  const nextUrl = Object.assign(u, {
    clone() {
      return Object.assign(new URL(u.href), {
        clone() {
          return Object.assign(new URL(u.href), { clone: this.clone });
        },
      });
    },
  });
  return {
    nextUrl,
    cookies: {
      getAll: () => [] as { name: string; value: string }[],
      set: () => undefined,
    },
    method,
  } as unknown as import("next/server").NextRequest;
}

describe("supabase middleware updateSession", () => {
  const original = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...original };
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("returns 401 JSON for protected APIs when auth unconfigured", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const { updateSession } = await import(
      "../../web/src/lib/supabase/middleware"
    );
    const res = await updateSession(makeReq("http://localhost/api/sync", "POST"));
    expect(res.status).toBe(401);
  });

  it("redirects /app to login when auth unconfigured", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const { updateSession } = await import(
      "../../web/src/lib/supabase/middleware"
    );
    const res = await updateSession(makeReq("http://localhost/app"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("allows public routes when unconfigured", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const { updateSession } = await import(
      "../../web/src/lib/supabase/middleware"
    );
    const res = await updateSession(makeReq("http://localhost/"));
    expect(res.status).toBe(200);
  });

  it("redirects unauthenticated /app when supabase configured", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    vi.doMock("@supabase/ssr", () => ({
      createServerClient: () => ({
        auth: {
          getUser: async () => ({ data: { user: null } }),
        },
      }),
    }));
    vi.resetModules();
    const { updateSession } = await import(
      "../../web/src/lib/supabase/middleware"
    );
    const res = await updateSession(makeReq("http://localhost/app/connect"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("returns 401 for unauthenticated ledger API", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    vi.doMock("@supabase/ssr", () => ({
      createServerClient: () => ({
        auth: {
          getUser: async () => ({ data: { user: null } }),
        },
      }),
    }));
    vi.resetModules();
    const { updateSession } = await import(
      "../../web/src/lib/supabase/middleware"
    );
    const res = await updateSession(makeReq("http://localhost/api/ledger"));
    expect(res.status).toBe(401);
  });

  it("redirects authenticated users away from login", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    vi.doMock("@supabase/ssr", () => ({
      createServerClient: (
        _u: string,
        _k: string,
        opts: {
          cookies: {
            setAll: (
              c: { name: string; value: string; options?: unknown }[],
            ) => void;
          };
        },
      ) => {
        opts.cookies.setAll([{ name: "sb", value: "1", options: {} }]);
        return {
          auth: {
            getUser: async () => ({
              data: { user: { id: "u1", email: "a@b.c" } },
            }),
          },
        };
      },
    }));
    vi.resetModules();
    const { updateSession } = await import(
      "../../web/src/lib/supabase/middleware"
    );
    const res = await updateSession(makeReq("http://localhost/login"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/app");
  });

  it("allows authenticated access to /app", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    vi.doMock("@supabase/ssr", () => ({
      createServerClient: () => ({
        auth: {
          getUser: async () => ({
            data: { user: { id: "u1", email: "a@b.c" } },
          }),
        },
      }),
    }));
    vi.resetModules();
    const { updateSession } = await import(
      "../../web/src/lib/supabase/middleware"
    );
    const res = await updateSession(makeReq("http://localhost/app"));
    expect(res.status).toBe(200);
  });
});
