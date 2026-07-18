/**
 * Client-side table pagination helpers for dashboard tabular views.
 */

export const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 500] as const;
export type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];

export const MAX_PAGE_SIZE = 500;
export const DEFAULT_PAGE_SIZE: PageSizeOption = 25;
export const PAGE_SIZE_STORAGE_KEY = "yieldscope.tablePageSize";

/** @deprecated Use DEFAULT_PAGE_SIZE — kept for call-site compatibility. */
export const DEFAULT_EVENTS_PAGE_SIZE = DEFAULT_PAGE_SIZE;
/** @deprecated Use DEFAULT_PAGE_SIZE — kept for call-site compatibility. */
export const DEFAULT_ASSETS_PAGE_SIZE = DEFAULT_PAGE_SIZE;

export interface PageSlice<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  from: number;
  to: number;
}

/** Clamp page into [1, totalPages] (empty lists → page 1). */
export function clampPage(page: number, totalPages: number): number {
  const tp = Math.max(1, totalPages);
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.floor(page), tp);
}

/** Snap to nearest allowed preset, never above MAX_PAGE_SIZE. */
export function clampPageSize(size: number): PageSizeOption {
  if (!Number.isFinite(size) || size < 1) return DEFAULT_PAGE_SIZE;
  const capped = Math.min(Math.floor(size), MAX_PAGE_SIZE);
  let best: PageSizeOption = PAGE_SIZE_OPTIONS[0];
  let bestDist = Math.abs(best - capped);
  for (const opt of PAGE_SIZE_OPTIONS) {
    const dist = Math.abs(opt - capped);
    if (dist < bestDist || (dist === bestDist && opt > best)) {
      best = opt;
      bestDist = dist;
    }
  }
  return best;
}

export function parsePageSize(
  raw: string | number | null | undefined,
): PageSizeOption {
  if (typeof raw === "number") return clampPageSize(raw);
  if (typeof raw !== "string") return DEFAULT_PAGE_SIZE;
  const n = Number.parseInt(raw.trim(), 10);
  return clampPageSize(n);
}

export function loadPageSizeFromStorage(
  storage: Pick<Storage, "getItem"> | null | undefined,
): PageSizeOption {
  if (!storage) return DEFAULT_PAGE_SIZE;
  try {
    return parsePageSize(storage.getItem(PAGE_SIZE_STORAGE_KEY));
  } catch {
    return DEFAULT_PAGE_SIZE;
  }
}

export function savePageSizeToStorage(
  size: number,
  storage: Pick<Storage, "setItem"> | null | undefined,
): void {
  if (!storage) return;
  try {
    storage.setItem(PAGE_SIZE_STORAGE_KEY, String(clampPageSize(size)));
  } catch {
    /* ignore quota / private mode */
  }
}

export function totalPagesFor(total: number, pageSize: number): number {
  const size = Math.max(1, pageSize);
  if (total <= 0) return 1;
  return Math.ceil(total / size);
}

/** Slice `items` for the given 1-based page. */
export function paginateItems<T>(
  items: T[],
  page: number,
  pageSize: number,
): PageSlice<T> {
  const total = items.length;
  const size = Math.max(1, pageSize);
  const totalPages = totalPagesFor(total, size);
  const safePage = clampPage(page, totalPages);
  const start = (safePage - 1) * size;
  const slice = items.slice(start, start + size);
  return {
    items: slice,
    page: safePage,
    pageSize: size,
    total,
    totalPages,
    from: total === 0 ? 0 : start + 1,
    to: start + slice.length,
  };
}
