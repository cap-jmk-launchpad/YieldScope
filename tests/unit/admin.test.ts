import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("supabase admin client", () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env = { ...original };
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("isAdminConfigured and createAdminClient return a client", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "role";
    const { createAdminClient, isAdminConfigured } = await import(
      "../../web/src/lib/supabase/admin"
    );
    expect(isAdminConfigured()).toBe(true);
    const client = createAdminClient();
    expect(client).toBeTruthy();
    expect(typeof client.from).toBe("function");
  });

  it("createAdminClient throws without env", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { createAdminClient, isAdminConfigured } = await import(
      "../../web/src/lib/supabase/admin"
    );
    expect(isAdminConfigured()).toBe(false);
    expect(() => createAdminClient()).toThrow(/admin unavailable/i);
  });
});
