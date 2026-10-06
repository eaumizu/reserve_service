import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { authorizeStaff, supabaseServer, query } = vi.hoisted(() => ({
  authorizeStaff: vi.fn(), supabaseServer: vi.fn(),
  query: { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn() },
}));
vi.mock("../lib/admin-auth", () => ({ authorizeStaff }));
vi.mock("../lib/supabase-server", () => ({ supabaseServer }));
import { GET } from "../app/api/admin/reservations/route";

beforeEach(() => {
  vi.resetAllMocks();
  supabaseServer.mockReturnValue({ from: () => query });
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.order.mockReturnValue(query);
});
describe("admin reservations API", () => {
  it("never reads reservation data without staff authorization", async () => {
    authorizeStaff.mockResolvedValue(null);
    const response = await GET(new NextRequest("http://localhost/api/admin/reservations"));
    expect(response.status).toBe(401);
    expect(supabaseServer).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("uses the verified staff store, ignoring the requested store", async () => {
    authorizeStaff.mockResolvedValue({ storeId: "trusted-store" });
    query.limit.mockResolvedValue({ data: [], error: null });
    const response = await GET(new NextRequest("http://localhost/api/admin/reservations?storeId=other-store", { headers: { authorization: "Bearer token" } }));
    expect(response.status).toBe(200);
    expect(query.eq).toHaveBeenCalledWith("store_id", "trusted-store");
    expect(await response.json()).toEqual({ reservations: [] });
  });
  it("does not expose database errors or partial records", async () => {
    authorizeStaff.mockResolvedValue({ storeId: "trusted-store" });
    query.limit.mockResolvedValue({ data: [{ id: "secret" }], error: { message: "private database error" } });
    const response = await GET(new NextRequest("http://localhost/api/admin/reservations"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/secret|private database error/);
  });
});
