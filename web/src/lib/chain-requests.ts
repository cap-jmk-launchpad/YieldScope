import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { ensureProfileId } from "@/lib/ledger-db";

const CHAIN_NAME_MAX = 120;
const WHY_MAX = 1000;
const EMAIL_MAX = 320;

/** Loose email check — enough to reject obvious junk; not full RFC. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class ChainRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChainRequestError";
  }
}

export type ChainRequestPayload = {
  chainName: string;
  why?: string | null;
  contactEmail?: string | null;
};

export type ValidatedChainRequest = {
  chainName: string;
  why: string | null;
  contactEmail: string | null;
};

/**
 * Validate POST body for /api/chain-requests.
 * chainName required; why and contactEmail optional.
 */
export function validateChainRequestPayload(
  input: unknown,
):
  | { ok: true; data: ValidatedChainRequest }
  | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Request body must be a JSON object." };
  }
  const body = input as Record<string, unknown>;

  const rawName =
    typeof body.chainName === "string"
      ? body.chainName
      : typeof body.chain_name === "string"
        ? body.chain_name
        : "";
  const chainName = rawName.trim();
  if (!chainName) {
    return { ok: false, error: "Chain or network name is required." };
  }
  if (chainName.length > CHAIN_NAME_MAX) {
    return {
      ok: false,
      error: `Chain name must be at most ${CHAIN_NAME_MAX} characters.`,
    };
  }

  const rawWhy =
    typeof body.why === "string"
      ? body.why
      : typeof body.earnType === "string"
        ? body.earnType
        : typeof body.earn_type === "string"
          ? body.earn_type
          : null;
  let why: string | null = null;
  if (rawWhy != null) {
    const trimmed = rawWhy.trim();
    if (trimmed) {
      if (trimmed.length > WHY_MAX) {
        return {
          ok: false,
          error: `Details must be at most ${WHY_MAX} characters.`,
        };
      }
      why = trimmed;
    }
  }

  const rawEmail =
    typeof body.contactEmail === "string"
      ? body.contactEmail
      : typeof body.contact_email === "string"
        ? body.contact_email
        : null;
  let contactEmail: string | null = null;
  if (rawEmail != null) {
    const trimmed = rawEmail.trim();
    if (trimmed) {
      if (trimmed.length > EMAIL_MAX) {
        return {
          ok: false,
          error: `Email must be at most ${EMAIL_MAX} characters.`,
        };
      }
      if (!EMAIL_RE.test(trimmed)) {
        return { ok: false, error: "Contact email looks invalid." };
      }
      contactEmail = trimmed.toLowerCase();
    }
  }

  return { ok: true, data: { chainName, why, contactEmail } };
}

export async function insertChainRequest(input: {
  userId: string;
  email?: string | null;
  chainName: string;
  why: string | null;
  contactEmail: string | null;
}): Promise<{ id: string }> {
  if (!isAdminConfigured()) {
    throw new ChainRequestError(
      "Database not configured — cannot save chain requests.",
    );
  }

  const profileId = await ensureProfileId(input.userId, input.email);
  const contactEmail =
    input.contactEmail ??
    (input.email && EMAIL_RE.test(input.email.trim())
      ? input.email.trim().toLowerCase()
      : null);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("chain_requests")
    .insert({
      user_id: input.userId,
      profile_id: profileId,
      chain_name: input.chainName,
      why: input.why,
      contact_email: contactEmail,
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new ChainRequestError(
      `Failed to save request: ${error?.message ?? "unknown"}`,
    );
  }
  return { id: data.id as string };
}

export async function listUserChainRequests(
  userId: string,
  limit = 10,
): Promise<
  Array<{
    id: string;
    chainName: string;
    why: string | null;
    createdAt: string;
  }>
> {
  if (!isAdminConfigured()) {
    throw new ChainRequestError(
      "Database not configured — cannot load chain requests.",
    );
  }
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("chain_requests")
    .select("id, chain_name, why, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 50));

  if (error) {
    throw new ChainRequestError(
      `Failed to load requests: ${error.message}`,
    );
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    chainName: row.chain_name as string,
    why: (row.why as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}
