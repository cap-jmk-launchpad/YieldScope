import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUser = vi.fn();
const loadDbLedger = vi.fn();

vi.mock("../../web/src/lib/auth/require-user", () => ({
  requireUser: () => requireUser(),
}));

vi.mock("../../web/src/lib/ledger-db", async () => {
  const actual = await vi.importActual<
    typeof import("../../web/src/lib/ledger-db")
  >("../../web/src/lib/ledger-db");
  return {
    ...actual,
    loadDbLedger: (...args: unknown[]) => loadDbLedger(...args),
  };
});

describe("GET /api/ledger pagination contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({
      user: { id: "u1", email: "a@b.c" },
      error: null,
    });
    loadDbLedger.mockResolvedValue({
      events: [],
      eventsTotal: 0,
      eventsMode: "page",
      eventsPage: 1,
      eventsPageSize: 25,
      sources: {},
      aggregates: { bySource: [], byAsset: [] },
      wallet: null,
      updatedAt: "2024-07-01T00:00:00.000Z",
    });
  });

  it("defaults to eventsMode=page with page size 25", async () => {
    const { GET } = await import("../../web/src/app/api/ledger/route");
    const res = await GET(new Request("http://localhost/api/ledger"));
    expect(res.status).toBe(200);
    expect(loadDbLedger).toHaveBeenCalledWith("u1", {
      eventsMode: "page",
      eventsPage: 1,
      eventsPageSize: 25,
      eventsSort: "earned_at",
      eventsOrder: "desc",
    });
  });

  it("honors eventsMode=none and chart and page params", async () => {
    const { GET } = await import("../../web/src/app/api/ledger/route");

    await GET(new Request("http://localhost/api/ledger?eventsMode=none"));
    expect(loadDbLedger).toHaveBeenLastCalledWith("u1", {
      eventsMode: "none",
    });

    await GET(new Request("http://localhost/api/ledger?view=chart"));
    expect(loadDbLedger).toHaveBeenLastCalledWith("u1", {
      eventsMode: "chart",
    });

    await GET(
      new Request(
        "http://localhost/api/ledger?eventsMode=page&eventsPage=3&eventsPageSize=100",
      ),
    );
    expect(loadDbLedger).toHaveBeenLastCalledWith("u1", {
      eventsMode: "page",
      eventsPage: 3,
      eventsPageSize: 100,
      eventsSort: "earned_at",
      eventsOrder: "desc",
    });
  });

  it("honors sort and order query params", async () => {
    const { GET } = await import("../../web/src/app/api/ledger/route");
    await GET(
      new Request(
        "http://localhost/api/ledger?eventsMode=page&sort=amount&order=asc",
      ),
    );
    expect(loadDbLedger).toHaveBeenLastCalledWith("u1", {
      eventsMode: "page",
      eventsPage: 1,
      eventsPageSize: 25,
      eventsSort: "amount",
      eventsOrder: "asc",
    });
  });

  it("caps eventsPageSize at 500", async () => {
    const { GET } = await import("../../web/src/app/api/ledger/route");
    await GET(
      new Request(
        "http://localhost/api/ledger?eventsMode=page&eventsPageSize=9999",
      ),
    );
    expect(loadDbLedger).toHaveBeenLastCalledWith("u1", {
      eventsMode: "page",
      eventsPage: 1,
      eventsPageSize: 500,
      eventsSort: "earned_at",
      eventsOrder: "desc",
    });
  });
});
