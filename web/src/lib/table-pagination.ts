/**
 * Client-side table pagination helpers for dashboard tabular views.
 */

export const DEFAULT_EVENTS_PAGE_SIZE = 25;
export const DEFAULT_ASSETS_PAGE_SIZE = 20;

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
