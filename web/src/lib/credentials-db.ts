import type { CexCredentials } from "@/lib/adapters/types";
import { parseLuncAddress } from "@/lib/adapters/lunc-stake";
import {
  decryptSecret,
  encryptSecret,
  maskApiKey,
  resolveCredentialsKeyMaterial,
} from "@/lib/credentials-crypto";
import { ensureProfileId } from "@/lib/ledger-db";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export type CredentialSource = "binance" | "okx" | "lunc_stake";

export interface BinanceCredPayload {
  apiKey: string;
  apiSecret: string;
}

export interface OkxCredPayload {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
}

export interface LuncCredPayload {
  address: string;
}

export type StoredCredPayload =
  | BinanceCredPayload
  | OkxCredPayload
  | LuncCredPayload;

export interface CredentialStatus {
  configured: boolean;
  keyHint?: string;
  updatedAt?: string;
}

export interface CredentialsStatusMap {
  binance: CredentialStatus;
  okx: CredentialStatus;
  lunc_stake: CredentialStatus;
  monad_stake: CredentialStatus;
}

export interface SaveCredentialsInput {
  userId: string;
  email?: string | null;
  binance?: BinanceCredPayload;
  okx?: OkxCredPayload;
  luncAddress?: string;
  walletAddress?: string;
  chainId?: number;
}

export class CredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialsError";
  }
}

function emptyStatus(): CredentialsStatusMap {
  return {
    binance: { configured: false },
    okx: { configured: false },
    lunc_stake: { configured: false },
    monad_stake: { configured: false },
  };
}

export function maskWalletAddress(address: string): string {
  const trimmed = address.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 10) return "••••";
  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
}

function hintFor(source: CredentialSource, payload: StoredCredPayload): string {
  if (source === "lunc_stake") {
    return maskWalletAddress((payload as LuncCredPayload).address);
  }
  return maskApiKey((payload as BinanceCredPayload | OkxCredPayload).apiKey);
}

export function summarizeSavedSources(status: CredentialsStatusMap): string {
  const parts: string[] = [];
  if (status.binance.configured) parts.push("Binance");
  if (status.okx.configured) parts.push("OKX");
  if (status.monad_stake.configured) parts.push("Monad wallet");
  if (status.lunc_stake.configured) parts.push("LUNC address");
  if (parts.length === 0) return "Nothing saved yet.";
  if (parts.length === 1) return `${parts[0]} saved successfully.`;
  const last = parts[parts.length - 1];
  return `${parts.slice(0, -1).join(", ")} and ${last} saved successfully.`;
}

export function validateSavePayload(input: {
  binance?: Partial<BinanceCredPayload> | null;
  okx?: Partial<OkxCredPayload> | null;
  luncAddress?: string | null;
  walletAddress?: string | null;
  chainId?: number | null;
}):
  | { ok: true; data: Omit<SaveCredentialsInput, "userId" | "email"> }
  | { ok: false; error: string } {
  const data: Omit<SaveCredentialsInput, "userId" | "email"> = {};
  let any = false;

  if (input.binance) {
    const key = input.binance.apiKey?.trim() ?? "";
    const secret = input.binance.apiSecret?.trim() ?? "";
    if (key || secret) {
      if (!key || !secret) {
        return {
          ok: false,
          error: "Binance requires both API key and API secret.",
        };
      }
      data.binance = { apiKey: key, apiSecret: secret };
      any = true;
    }
  }

  if (input.okx) {
    const key = input.okx.apiKey?.trim() ?? "";
    const secret = input.okx.apiSecret?.trim() ?? "";
    const pass = input.okx.passphrase?.trim() ?? "";
    if (key || secret || pass) {
      if (!key || !secret || !pass) {
        return {
          ok: false,
          error: "OKX requires API key, secret, and passphrase.",
        };
      }
      data.okx = { apiKey: key, apiSecret: secret, passphrase: pass };
      any = true;
    }
  }

  const lunc = input.luncAddress?.trim() ?? "";
  if (lunc) {
    try {
      // Normalize explorer links → terra1…; reject garbage early.
      data.luncAddress = parseLuncAddress(lunc);
    } catch (err) {
      return {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Invalid Terra Classic address — paste a terra1… address or explorer link",
      };
    }
    any = true;
  }

  const wallet = input.walletAddress?.trim() ?? "";
  if (wallet) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return {
        ok: false,
        error: "Monad wallet address must be a valid 0x… address.",
      };
    }
    data.walletAddress = wallet.toLowerCase();
    if (typeof input.chainId === "number" && Number.isFinite(input.chainId)) {
      data.chainId = input.chainId;
    }
    any = true;
  }

  if (!any) {
    return {
      ok: false,
      error:
        "Enter at least one complete source (API keys, LUNC address, or connected wallet) to save.",
    };
  }

  return { ok: true, data };
}

export async function loadCredentialsStatus(
  userId: string,
): Promise<CredentialsStatusMap> {
  if (!isAdminConfigured()) {
    throw new CredentialsError(
      "Database not configured — cannot load credentials.",
    );
  }

  const admin = createAdminClient();
  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (profileErr) {
    throw new CredentialsError(`Profile lookup failed: ${profileErr.message}`);
  }
  if (!profile?.id) return emptyStatus();

  const [credsRes, walletRes] = await Promise.all([
    admin
      .from("source_credentials")
      .select("source,key_hint,updated_at")
      .eq("profile_id", profile.id),
    admin
      .from("wallet_connections")
      .select("address,chain_id,last_seen_at")
      .eq("profile_id", profile.id)
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (credsRes.error) {
    throw new CredentialsError(
      `Failed loading credentials: ${credsRes.error.message}`,
    );
  }
  if (walletRes.error) {
    throw new CredentialsError(
      `Failed loading wallet: ${walletRes.error.message}`,
    );
  }

  const status = emptyStatus();
  for (const row of credsRes.data ?? []) {
    const source = row.source as CredentialSource;
    if (source === "binance" || source === "okx" || source === "lunc_stake") {
      status[source] = {
        configured: true,
        keyHint: row.key_hint ?? "•••• saved",
        updatedAt: row.updated_at ?? undefined,
      };
    }
  }

  if (walletRes.data?.address) {
    status.monad_stake = {
      configured: true,
      keyHint: maskWalletAddress(String(walletRes.data.address)),
      updatedAt: walletRes.data.last_seen_at ?? undefined,
    };
  }

  return status;
}

export async function saveCredentials(
  input: SaveCredentialsInput,
): Promise<CredentialsStatusMap> {
  if (!isAdminConfigured()) {
    throw new CredentialsError(
      "Database not configured — cannot save credentials.",
    );
  }

  const validated = validateSavePayload(input);
  if (!validated.ok) {
    throw new CredentialsError(validated.error);
  }

  const profileId = await ensureProfileId(input.userId, input.email);
  const admin = createAdminClient();
  const asOf = new Date().toISOString();

  const upserts: Array<{
    profile_id: string;
    source: CredentialSource;
    ciphertext: string;
    key_hint: string;
    updated_at: string;
  }> = [];

  if (validated.data.binance || validated.data.okx || validated.data.luncAddress) {
    const keyMaterial = resolveCredentialsKeyMaterial();
    if (validated.data.binance) {
      upserts.push({
        profile_id: profileId,
        source: "binance",
        ciphertext: encryptSecret(
          JSON.stringify(validated.data.binance),
          keyMaterial,
        ),
        key_hint: hintFor("binance", validated.data.binance),
        updated_at: asOf,
      });
    }
    if (validated.data.okx) {
      upserts.push({
        profile_id: profileId,
        source: "okx",
        ciphertext: encryptSecret(
          JSON.stringify(validated.data.okx),
          keyMaterial,
        ),
        key_hint: hintFor("okx", validated.data.okx),
        updated_at: asOf,
      });
    }
    if (validated.data.luncAddress) {
      const payload: LuncCredPayload = { address: validated.data.luncAddress };
      upserts.push({
        profile_id: profileId,
        source: "lunc_stake",
        ciphertext: encryptSecret(JSON.stringify(payload), keyMaterial),
        key_hint: hintFor("lunc_stake", payload),
        updated_at: asOf,
      });
    }
  }

  if (upserts.length > 0) {
    const { error } = await admin.from("source_credentials").upsert(upserts, {
      onConflict: "profile_id,source",
    });
    if (error) {
      throw new CredentialsError(`Failed saving credentials: ${error.message}`);
    }
  }

  if (validated.data.walletAddress) {
    const chainId = validated.data.chainId ?? 10143;
    const { error: walletErr } = await admin.from("wallet_connections").upsert(
      {
        profile_id: profileId,
        address: validated.data.walletAddress,
        chain_id: chainId,
        last_seen_at: asOf,
      },
      { onConflict: "profile_id,address,chain_id" },
    );
    if (walletErr) {
      throw new CredentialsError(
        `Failed saving wallet: ${walletErr.message}`,
      );
    }
    const { error: profileWalletErr } = await admin
      .from("profiles")
      .update({ wallet_address: validated.data.walletAddress })
      .eq("id", profileId);
    if (profileWalletErr) {
      throw new CredentialsError(
        `Failed updating profile wallet: ${profileWalletErr.message}`,
      );
    }
  }

  return loadCredentialsStatus(input.userId);
}

async function loadDecrypted(
  userId: string,
  source: CredentialSource,
): Promise<StoredCredPayload | null> {
  if (!isAdminConfigured()) return null;

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!profile?.id) return null;

  const { data: row, error } = await admin
    .from("source_credentials")
    .select("ciphertext")
    .eq("profile_id", profile.id)
    .eq("source", source)
    .maybeSingle();
  if (error || !row?.ciphertext) return null;

  try {
    const keyMaterial = resolveCredentialsKeyMaterial();
    return JSON.parse(
      decryptSecret(row.ciphertext as string, keyMaterial),
    ) as StoredCredPayload;
  } catch {
    throw new CredentialsError(`Failed decrypting ${source} credentials`);
  }
}

export async function loadBinanceCredentials(
  userId: string,
): Promise<CexCredentials | null> {
  const payload = await loadDecrypted(userId, "binance");
  if (!payload || !("apiSecret" in payload) || !("apiKey" in payload)) {
    return null;
  }
  if ("passphrase" in payload) return null;
  return {
    apiKey: payload.apiKey,
    apiSecret: (payload as BinanceCredPayload).apiSecret,
  };
}

export async function loadOkxCredentials(
  userId: string,
): Promise<CexCredentials | null> {
  const payload = await loadDecrypted(userId, "okx");
  if (!payload || !("passphrase" in payload)) return null;
  const okx = payload as OkxCredPayload;
  return {
    apiKey: okx.apiKey,
    apiSecret: okx.apiSecret,
    passphrase: okx.passphrase,
  };
}

export async function loadLuncAddress(userId: string): Promise<string | null> {
  const payload = await loadDecrypted(userId, "lunc_stake");
  if (!payload || !("address" in payload)) return null;
  return (payload as LuncCredPayload).address || null;
}

export async function loadMonadWalletAddress(
  userId: string,
): Promise<string | null> {
  if (!isAdminConfigured()) return null;

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!profile?.id) return null;

  const { data: row, error } = await admin
    .from("wallet_connections")
    .select("address")
    .eq("profile_id", profile.id)
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !row?.address) return null;
  return String(row.address);
}
