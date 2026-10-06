import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { authorizeStaff, adminAvailableStarts, supabaseServer, queryDb } = vi.hoisted(() => ({
  authorizeStaff: vi.fn(), adminAvailableStarts: vi.fn(), supabaseServer: vi.fn(),
  queryDb: { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() },
}));
vi.mock("../lib/admin-auth", () => ({ authorizeStaff }));
vi.mock("../lib/supabase-server", () => ({ supabaseServer }));
vi.mock("../lib/reservations/admin-availability", async importOriginal => ({
  ...await importOriginal<typeof import("../lib/reservations/admin-availability")>(), adminAvailableStarts,
}));
import { GET } from "../app/api/admin/availability/route";
const query = "serviceId=55555555-5555-5555-5555-555555555555&staffId=22222222-2222-2222-2222-222222222222&date=2030-01-01&storeId=untrusted-store";
beforeEach(() => {
  vi.resetAllMocks();
  supabaseServer.mockReturnValue({ from: () => queryDb });
  queryDb.select.mockReturnValue(queryDb); queryDb.eq.mockReturnValue(queryDb);
});
describe("admin slot access", () => {
  it("does not read slots without staff login", async () => {
    authorizeStaff.mockResolvedValue(null);
    expect((await GET(new NextRequest(`http://localhost/api/admin/availability?${query}`))).status).toBe(401);
    expect(adminAvailableStarts).not.toHaveBeenCalled();
  });
  it("uses the verified store and returns a non-cacheable response", async () => {
    authorizeStaff.mockResolvedValue({ storeId: "verified-store" });
    adminAvailableStarts.mockResolvedValue([]);
    const response = await GET(new NextRequest(`http://localhost/api/admin/availability?${query}`));
    expect(response.status).toBe(200);
    expect(adminAvailableStarts).toHaveBeenCalledWith("verified-store", "55555555-5555-5555-5555-555555555555", "22222222-2222-2222-2222-222222222222", "2030-01-01");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("rejects malformed or impossible dates without querying slots", async () => {
    authorizeStaff.mockResolvedValue({ storeId: "verified-store" });
    expect((await GET(new NextRequest(`http://localhost/api/admin/availability?${query.replace("2030-01-01", "2030-02-30")}`))).status).toBe(400);
    expect(adminAvailableStarts).not.toHaveBeenCalled();
  });
  it("verifies the reservation belongs to the store before excluding it", async () => {
    authorizeStaff.mockResolvedValue({ storeId: "verified-store" });
    queryDb.maybeSingle.mockResolvedValue({ data: { service_id: "55555555-5555-5555-5555-555555555555", status: "confirmed" }, error: null });
    adminAvailableStarts.mockResolvedValue([]);
    const id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const response = await GET(new NextRequest(`http://localhost/api/admin/availability?${query}&reservationId=${id}`));
    expect(response.status).toBe(200);
    expect(queryDb.eq).toHaveBeenCalledWith("store_id", "verified-store");
    expect(adminAvailableStarts).toHaveBeenCalledWith("verified-store", "55555555-5555-5555-5555-555555555555", "22222222-2222-2222-2222-222222222222", "2030-01-01", id);
  });
  it("does not exclude a missing or foreign-store reservation", async () => {
    authorizeStaff.mockResolvedValue({ storeId: "verified-store" });
    queryDb.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await GET(new NextRequest(`http://localhost/api/admin/availability?${query}&reservationId=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`))).status).toBe(404);
    expect(adminAvailableStarts).not.toHaveBeenCalled();
  });
  it("does not exclude a cancelled or mismatched-service reservation", async () => {
    authorizeStaff.mockResolvedValue({ storeId: "verified-store" });
    queryDb.maybeSingle.mockResolvedValue({ data: { service_id: "other-service", status: "cancelled" }, error: null });
    expect((await GET(new NextRequest(`http://localhost/api/admin/availability?${query}&reservationId=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`))).status).toBe(409);
    expect(adminAvailableStarts).not.toHaveBeenCalled();
  });
});
