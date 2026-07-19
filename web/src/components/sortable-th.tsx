"use client";

type SortableThProps = {
  label: string;
  columnKey: string;
  activeKey: string;
  order: "asc" | "desc";
  onSort: (key: string) => void;
  disabled?: boolean;
};

export function SortableTh({
  label,
  columnKey,
  activeKey,
  order,
  onSort,
  disabled,
}: SortableThProps) {
  const active = activeKey === columnKey;
  const ariaSort = active
    ? order === "asc"
      ? "ascending"
      : "descending"
    : "none";
  return (
    <th aria-sort={ariaSort}>
      <button
        type="button"
        className={`sort-th${active ? " sort-th--active" : ""}`}
        onClick={() => onSort(columnKey)}
        disabled={disabled}
        aria-label={`Sort by ${label}${active ? `, currently ${order}ending` : ""}`}
      >
        <span>{label}</span>
        <span className="sort-th-indicator" aria-hidden>
          {active ? (order === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
}
