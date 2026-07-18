import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import {
  CredentialsError,
  loadCredentialsStatus,
  saveCredentials,
  summarizeSavedSources,
  validateSavePayload,
} from "@/lib/credentials-db";

export async function GET() {
  const gate = await requireUser();
  if (gate.error) return gate.error;

  try {
    const status = await loadCredentialsStatus(gate.user.id);
    return NextResponse.json({ status });
  } catch (err) {
    const message =
      err instanceof CredentialsError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Failed to load credentials";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function PUT(req: Request) {
  const gate = await requireUser();
  if (gate.error) return gate.error;

  const body = (await req.json().catch(() => ({}))) as {
    binance?: { apiKey?: string; apiSecret?: string };
    okx?: { apiKey?: string; apiSecret?: string; passphrase?: string };
    luncAddress?: string;
    walletAddress?: string;
    chainId?: number;
  };

  const validated = validateSavePayload(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  try {
    const status = await saveCredentials({
      userId: gate.user.id,
      email: gate.user.email,
      ...validated.data,
    });
    return NextResponse.json({
      ok: true,
      message: summarizeSavedSources(status),
      status,
    });
  } catch (err) {
    const message =
      err instanceof CredentialsError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Failed to save credentials";
    const status =
      err instanceof CredentialsError && message.includes("not configured")
        ? 503
        : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
