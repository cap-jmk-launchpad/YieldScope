import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import {
  DEFAULT_LEDGER_EVENTS_PAGE_SIZE,
  loadDbLedger,
  LedgerPersistError,
  MAX_LEDGER_EVENTS_PAGE_SIZE,
  type LedgerEventsMode,
  type LoadDbLedgerOptions,
} from "@/lib/ledger-db";

function parseEventsMode(raw: string | null): LedgerEventsMode {
  if (raw === "all" || raw === "none" || raw === "chart" || raw === "page") {
    return raw;
  }
  // Dashboard default: one page of events + aggregates (not the full history).
  return "page";
}

function parsePositiveInt(
  raw: string | null,
  fallback: number,
  max: number,
): number {
  if (raw == null || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

/**
 * GET /api/ledger
 *
 * Query:
 * - `eventsMode` / `view`: `page` (default) | `none` | `chart` | `all`
 * - `eventsPage` (1-based, default 1) + `eventsPageSize` (default 25, max 500)
 *
 * `page` — aggregates + one events table page (fast TTI).
 * `none` — aggregates/sources only.
 * `chart` — daily×asset series for deferred charts.
 * `all` — full event history (checkpoint / legacy).
 */
export async function GET(req: Request) {
  const gate = await requireUser();
  if (gate.error) return gate.error;

  const url = new URL(req.url);
  const eventsMode = parseEventsMode(
    url.searchParams.get("eventsMode") ?? url.searchParams.get("view"),
  );
  const options: LoadDbLedgerOptions = { eventsMode };
  if (eventsMode === "page") {
    options.eventsPage = parsePositiveInt(
      url.searchParams.get("eventsPage"),
      1,
      1_000_000,
    );
    options.eventsPageSize = parsePositiveInt(
      url.searchParams.get("eventsPageSize"),
      DEFAULT_LEDGER_EVENTS_PAGE_SIZE,
      MAX_LEDGER_EVENTS_PAGE_SIZE,
    );
  }

  try {
    const ledger = await loadDbLedger(gate.user.id, options);
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
