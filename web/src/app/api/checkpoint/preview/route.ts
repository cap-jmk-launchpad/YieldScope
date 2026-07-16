import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { loadDbLedger, LedgerPersistError } from "@/lib/ledger-db";
import { merkleRoot, windowBounds } from "@/lib/merkle";

export async function GET() {
  const gate = await requireUser();
  if (gate.error) return gate.error;

  try {
    const ledger = await loadDbLedger(gate.user.id);
    const root = merkleRoot(ledger.events);
    const bounds = windowBounds(ledger.events);
    return NextResponse.json({
      root,
      ...bounds,
      eventCount: ledger.events.length,
      sources: ledger.sources,
      aggregates: ledger.aggregates,
    });
  } catch (err) {
    const message =
      err instanceof LedgerPersistError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Checkpoint preview failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
