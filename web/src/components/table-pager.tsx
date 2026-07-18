"use client";

interface TablePagerProps {
  label: string;
  page: number;
  totalPages: number;
  from: number;
  to: number;
  total: number;
  onPageChange: (page: number) => void;
}

/** Prev/next pager for dashboard tables (hidden when a single page). */
export function TablePager({
  label,
  page,
  totalPages,
  from,
  to,
  total,
  onPageChange,
}: TablePagerProps) {
  if (total <= 0 || totalPages <= 1) return null;

  return (
    <div className="table-pager" role="navigation" aria-label={label}>
      <span className="table-pager-meta">
        {from}–{to} of {total}
      </span>
      <div className="table-pager-actions">
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
      </div>
    </div>
  );
}
