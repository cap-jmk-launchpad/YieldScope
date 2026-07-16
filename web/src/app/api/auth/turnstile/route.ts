import { NextResponse } from "next/server";
import { verifyTurnstile } from "@/lib/auth/turnstile";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { token?: string };
  const result = await verifyTurnstile(body.token);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
