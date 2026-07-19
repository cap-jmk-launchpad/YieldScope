/**
 * Client-side sort helpers for dashboard tables that hold a full in-memory set
 * (by-asset aggregates). Events use server-side sort via /api/ledger.
 */

export type SortOrder = "asc" | "desc";

export function toggleSortOrder(
  currentKey: string,
  nextKey: string,
  currentOrder: SortOrder,
  defaultOrder: SortOrder = "desc",
): SortOrder {
  if (currentKey === nextKey) {
    return currentOrder === "asc" ? "desc" : "asc";
  }
  return defaultOrder;
}

export function compareStrings(a: string, b: string, order: SortOrder): number {
  const cmp = a.localeCompare(b, undefined, { sensitivity: "base" });
  return order === "asc" ? cmp : -cmp;
}

export function compareNumbers(a: number, b: number, order: SortOrder): number {
  const av = Number.isFinite(a) ? a : 0;
  const bv = Number.isFinite(b) ? b : 0;
  const cmp = av - bv;
  return order === "asc" ? cmp : -cmp;
}

export type AssetSortKey = "asset" | "source" | "events" | "native" | "fiat";

export interface AssetSortRow {
  asset: string;
  source: string;
  eventCount: number;
  totalAmount: string;
  /** Precomputed display-currency total; null when rate missing. */
  fiatTotal?: number | null;
}

export function sortAssetRows<T extends AssetSortRow>(
  rows: T[],
  key: AssetSortKey,
  order: SortOrder,
): T[] {
  const copy = [...rows];
  copy.sort((a, b) => {
    let primary = 0;
    switch (key) {
      case "asset":
        primary = compareStrings(a.asset, b.asset, order);
        break;
      case "source":
        primary = compareStrings(a.source, b.source, order);
        break;
      case "events":
        primary = compareNumbers(a.eventCount, b.eventCount, order);
        break;
      case "native":
        primary = compareNumbers(Number(a.totalAmount), Number(b.totalAmount), order);
        break;
      case "fiat": {
        const af = a.fiatTotal;
        const bf = b.fiatTotal;
        const aMissing = af == null || !Number.isFinite(af);
        const bMissing = bf == null || !Number.isFinite(bf);
        if (aMissing && bMissing) primary = 0;
        else if (aMissing) primary = 1;
        else if (bMissing) primary = -1;
        else primary = compareNumbers(af, bf, order);
        break;
      }
      default:
        primary = 0;
    }
    if (primary !== 0) return primary;
    return (
      a.asset.localeCompare(b.asset) || a.source.localeCompare(b.source)
    );
  });
  return copy;
}

export function sortAriaSort(
  activeKey: string,
  columnKey: string,
  order: SortOrder,
): "ascending" | "descending" | "none" {
  if (activeKey !== columnKey) return "none";
  return order === "asc" ? "ascending" : "descending";
}
