import { describe, expect, it } from "vitest";
import {
  clampPage,
  clampPageSize,
  DEFAULT_PAGE_SIZE,
  loadPageSizeFromStorage,
  MAX_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  PAGE_SIZE_STORAGE_KEY,
  paginateItems,
  parsePageSize,
  savePageSizeToStorage,
  totalPagesFor,
} from "../../web/src/lib/table-pagination";

describe("table-pagination", () => {
  it("exposes presets up to 500", () => {
    expect(PAGE_SIZE_OPTIONS).toEqual([25, 50, 100, 250, 500]);
    expect(MAX_PAGE_SIZE).toBe(500);
    expect(DEFAULT_PAGE_SIZE).toBe(25);
    expect(Math.max(...PAGE_SIZE_OPTIONS)).toBe(MAX_PAGE_SIZE);
  });

  it("computes total pages", () => {
    expect(totalPagesFor(0, 25)).toBe(1);
    expect(totalPagesFor(25, 25)).toBe(1);
    expect(totalPagesFor(26, 25)).toBe(2);
    expect(totalPagesFor(100, 25)).toBe(4);
    expect(totalPagesFor(501, 500)).toBe(2);
  });

  it("clamps page into range", () => {
    expect(clampPage(0, 3)).toBe(1);
    expect(clampPage(-2, 3)).toBe(1);
    expect(clampPage(99, 3)).toBe(3);
    expect(clampPage(2.7, 5)).toBe(2);
  });

  it("clamps page size to presets and max 500", () => {
    expect(clampPageSize(25)).toBe(25);
    expect(clampPageSize(500)).toBe(500);
    expect(clampPageSize(0)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampPageSize(-1)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampPageSize(999)).toBe(MAX_PAGE_SIZE);
    expect(clampPageSize(40)).toBe(50);
    expect(clampPageSize(Number.NaN)).toBe(DEFAULT_PAGE_SIZE);
  });

  it("parses page size from raw values", () => {
    expect(parsePageSize("100")).toBe(100);
    expect(parsePageSize("500")).toBe(500);
    expect(parsePageSize("1000")).toBe(MAX_PAGE_SIZE);
    expect(parsePageSize("nope")).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageSize(null)).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
  });

  it("loads and saves page size via storage", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    };

    expect(loadPageSizeFromStorage(null)).toBe(DEFAULT_PAGE_SIZE);
    expect(loadPageSizeFromStorage(storage)).toBe(DEFAULT_PAGE_SIZE);

    savePageSizeToStorage(250, storage);
    expect(store.get(PAGE_SIZE_STORAGE_KEY)).toBe("250");
    expect(loadPageSizeFromStorage(storage)).toBe(250);

    savePageSizeToStorage(999, storage);
    expect(loadPageSizeFromStorage(storage)).toBe(MAX_PAGE_SIZE);
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

    const large = paginateItems(items, 1, 500);
    expect(large.items).toHaveLength(30);
    expect(large.totalPages).toBe(1);
  });

  it("handles empty lists", () => {
    const empty = paginateItems([], 3, 10);
    expect(empty.items).toEqual([]);
    expect(empty.page).toBe(1);
    expect(empty.from).toBe(0);
    expect(empty.to).toBe(0);
  });
});
