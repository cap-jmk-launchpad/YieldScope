import { describe, expect, it } from "vitest";
import {
  clampPage,
  paginateItems,
  totalPagesFor,
} from "../../web/src/lib/table-pagination";

describe("table-pagination", () => {
  it("computes total pages", () => {
    expect(totalPagesFor(0, 25)).toBe(1);
    expect(totalPagesFor(25, 25)).toBe(1);
    expect(totalPagesFor(26, 25)).toBe(2);
    expect(totalPagesFor(100, 25)).toBe(4);
  });

  it("clamps page into range", () => {
    expect(clampPage(0, 3)).toBe(1);
    expect(clampPage(-2, 3)).toBe(1);
    expect(clampPage(99, 3)).toBe(3);
    expect(clampPage(2.7, 5)).toBe(2);
  });

  it("slices items for a page", () => {
    const items = Array.from({ length: 30 }, (_, i) => i + 1);
    const page1 = paginateItems(items, 1, 25);
    expect(page1.items).toEqual(items.slice(0, 25));
    expect(page1.from).toBe(1);
    expect(page1.to).toBe(25);
    expect(page1.totalPages).toBe(2);

    const page2 = paginateItems(items, 2, 25);
    expect(page2.items).toEqual([26, 27, 28, 29, 30]);
    expect(page2.from).toBe(26);
    expect(page2.to).toBe(30);

    const overflow = paginateItems(items, 9, 25);
    expect(overflow.page).toBe(2);
    expect(overflow.items).toHaveLength(5);
  });

  it("handles empty lists", () => {
    const empty = paginateItems([], 3, 10);
    expect(empty.items).toEqual([]);
    expect(empty.page).toBe(1);
    expect(empty.from).toBe(0);
    expect(empty.to).toBe(0);
  });
});
