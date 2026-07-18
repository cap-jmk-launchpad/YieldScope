import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

/** AES-256-GCM payload: base64url(iv || tag || ciphertext) */
export function encryptSecret(plaintext: string, keyMaterial: string): string {
  const key = deriveKey(keyMaterial);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function decryptSecret(payload: string, keyMaterial: string): string {
  const key = deriveKey(keyMaterial);
  const buf = Buffer.from(payload, "base64url");
  if (buf.length < 28) {
    throw new Error("Invalid ciphertext");
  }
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}

function deriveKey(keyMaterial: string): Buffer {
  return createHash("sha256")
    .update(`yieldscope-creds:v1:${keyMaterial}`)
    .digest();
}

/** Mask for UI — never returns the full secret. */
export function maskApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 4) return "••••";
  return `••••${trimmed.slice(-4)}`;
}

export function resolveCredentialsKeyMaterial(): string {
  const dedicated = process.env.CREDENTIALS_ENCRYPTION_KEY?.trim();
  if (dedicated) return dedicated;
  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (fallback) return fallback;
  throw new Error(
    "Credentials encryption not configured — set CREDENTIALS_ENCRYPTION_KEY or SUPABASE_SERVICE_ROLE_KEY",
  );
}
