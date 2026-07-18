import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  maskApiKey,
  resolveCredentialsKeyMaterial,
} from "../../web/src/lib/credentials-crypto";

describe("credentials-crypto", () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env = { ...original };
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("round-trips AES-GCM encryption", () => {
    const key = "test-material-abc";
    const cipher = encryptSecret('{"apiKey":"k","apiSecret":"s"}', key);
    expect(cipher).not.toContain("apiKey");
    expect(decryptSecret(cipher, key)).toBe('{"apiKey":"k","apiSecret":"s"}');
  });

  it("rejects truncated ciphertext", () => {
    expect(() => decryptSecret("YWJj", "key")).toThrow(/Invalid ciphertext/);
  });

  it("maskApiKey hides all but last 4", () => {
    expect(maskApiKey("abcdefghij")).toBe("••••ghij");
    expect(maskApiKey("ab")).toBe("••••");
    expect(maskApiKey("")).toBe("");
  });

  it("resolveCredentialsKeyMaterial prefers dedicated key", () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = "dedicated";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    expect(resolveCredentialsKeyMaterial()).toBe("dedicated");
  });

  it("resolveCredentialsKeyMaterial falls back to service role", () => {
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    expect(resolveCredentialsKeyMaterial()).toBe("service-role");
  });

  it("resolveCredentialsKeyMaterial fails closed when missing", () => {
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => resolveCredentialsKeyMaterial()).toThrow(/not configured/);
  });
});
