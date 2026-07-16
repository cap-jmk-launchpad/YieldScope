import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { loadDbLedger, LedgerPersistError } from "@/lib/ledger-db";

export async function GET() {
  const gate = await requireUser();
  if (gate.error) return gate.error;

  try {
    const ledger = await loadDbLedger(gate.user.id);
    return NextResponse.json(ledger);
  } catch (err) {
    const message =
      err instanceof LedgerPersistError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Ledger load failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
