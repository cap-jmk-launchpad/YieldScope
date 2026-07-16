import { NextResponse } from "next/server";
import { merkleRoot, windowBounds } from "@/lib/merkle";
import { snapshot } from "@/lib/sync";

export async function GET() {
  const ledger = snapshot();
  const root = merkleRoot(ledger.events);
  const bounds = windowBounds(ledger.events);
  return NextResponse.json({
    root,
    ...bounds,
    eventCount: ledger.events.length,
    sources: ledger.sources,
  });
}
