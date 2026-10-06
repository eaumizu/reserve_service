import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { authorizeStaff, adminAvailableStarts } = vi.hoisted(() => ({ authorizeStaff: vi.fn(), adminAvailableStarts: vi.fn() }));
vi.mock("../lib/admin-auth", () => ({ authorizeStaff }));
vi.mock("../lib/reservations/admin-availability", async importOriginal => ({
  ...await importOriginal<typeof import("../lib/reservations/admin-availability")>(), adminAvailableStarts,
}));
import { GET } from "../app/api/admin/availability/route";
const query = "serviceId=55555555-5555-5555-5555-555555555555&staffId=22222222-2222-2222-2222-222222222222&date=2030-01-01&storeId=untrusted-store";
beforeEach(() => vi.resetAllMocks());
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
});
