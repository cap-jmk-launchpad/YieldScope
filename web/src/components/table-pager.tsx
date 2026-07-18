"use client";

import {
  PAGE_SIZE_OPTIONS,
  type PageSizeOption,
} from "@/lib/table-pagination";

interface TablePagerProps {
  label: string;
  page: number;
  totalPages: number;
  from: number;
  to: number;
  total: number;
  pageSize: PageSizeOption;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: PageSizeOption) => void;
}

/** Prev/next pager + rows-per-page for dashboard tables. */
export function TablePager({
  label,
  page,
  totalPages,
  from,
  to,
  total,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: TablePagerProps) {
  if (total <= 0) return null;

  const showNav = totalPages > 1;

  return (
    <div className="table-pager" role="navigation" aria-label={label}>
      <span className="table-pager-meta">
        {from}–{to} of {total}
      </span>
      <div className="table-pager-actions">
        <label className="table-pager-size">
          <span className="table-pager-size-label">Rows</span>
          <select
            value={pageSize}
            onChange={(e) =>
              onPageSizeChange(Number(e.target.value) as PageSizeOption)
            }
            aria-label={`${label} rows per page`}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {showNav ? (
          <>
            <button
              type="button"
              className="table-pager-btn"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              aria-label="Previous page"
            >
              Prev
            </button>
            <span className="table-pager-page">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              className="table-pager-btn"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              aria-label="Next page"
            >
              Next
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
