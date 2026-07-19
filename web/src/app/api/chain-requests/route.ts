import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import {
  ChainRequestError,
  insertChainRequest,
  listUserChainRequests,
  validateChainRequestPayload,
} from "@/lib/chain-requests";

export async function GET() {
  const gate = await requireUser();
  if (gate.error) return gate.error;

  try {
    const requests = await listUserChainRequests(gate.user.id);
    return NextResponse.json({ requests });
  } catch (err) {
    const message =
      err instanceof ChainRequestError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Failed to load chain requests";
    const status =
      err instanceof ChainRequestError && message.includes("not configured")
        ? 503
        : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(req: Request) {
  const gate = await requireUser();
  if (gate.error) return gate.error;

  const body = await req.json().catch(() => null);
  const validated = validateChainRequestPayload(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  try {
    const { id } = await insertChainRequest({
      userId: gate.user.id,
      email: gate.user.email,
      ...validated.data,
    });
    return NextResponse.json({
      ok: true,
      id,
      message: "Thanks — we logged your chain request.",
    });
  } catch (err) {
    const message =
      err instanceof ChainRequestError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Failed to save chain request";
    const status =
      err instanceof ChainRequestError && message.includes("not configured")
        ? 503
        : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
