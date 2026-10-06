import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { authorizeStaff, supabaseServer, from } = vi.hoisted(() => ({ authorizeStaff: vi.fn(), supabaseServer: vi.fn(), from: vi.fn() }));
vi.mock("../lib/admin-auth", () => ({ authorizeStaff }));
vi.mock("../lib/supabase-server", () => ({ supabaseServer }));
import { GET } from "../app/api/admin/booking-options/route";

beforeEach(() => { vi.resetAllMocks(); supabaseServer.mockReturnValue({ from }); });
describe("manual booking options", () => {
  it("does not expose catalog without staff authentication", async () => {
    authorizeStaff.mockResolvedValue(null);
    const response = await GET(new NextRequest("http://localhost/api/admin/booking-options"));
    expect(response.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });
  it("scopes services, staff and both sides of assignments to the verified store", async () => {
    authorizeStaff.mockResolvedValue({ storeId: "verified-store" });
    const queries: Record<string, { eq: ReturnType<typeof vi.fn> }> = {};
    from.mockImplementation(table => {
      const q = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }) };
      q.select.mockReturnValue(q); q.eq.mockReturnValue(q); q.order.mockReturnValue(q);
      queries[table] = q;
      return q;
    });
    const response = await GET(new NextRequest("http://localhost/api/admin/booking-options?storeId=other-store"));
    expect(response.status).toBe(200);
    expect(queries.services.eq).toHaveBeenCalledWith("store_id", "verified-store");
    expect(queries.staff.eq).toHaveBeenCalledWith("store_id", "verified-store");
    expect(queries.staff_services.eq).toHaveBeenCalledWith("staff.store_id", "verified-store");
    expect(queries.staff_services.eq).toHaveBeenCalledWith("services.store_id", "verified-store");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
