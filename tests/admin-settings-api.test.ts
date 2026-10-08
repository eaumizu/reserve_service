vi.mock("../lib/booking-rules-server", () => ({ readBookingRules: async () => ({ advance_days: 30, cutoff_minutes: 60 }) }));
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { authorizeStaff, supabaseServer, from, rpc } = vi.hoisted(() => ({ authorizeStaff: vi.fn(), supabaseServer: vi.fn(), from: vi.fn(), rpc: vi.fn() }));
vi.mock("../lib/admin-auth", () => ({ authorizeStaff }));
vi.mock("../lib/supabase-server", () => ({ supabaseServer }));
import { GET, POST } from "../app/api/admin/settings/route";
const request = (data = { kind: "store", data: { name: "新店舗" } }) => new NextRequest("http://localhost/api/admin/settings", {
  method: "POST", headers: { authorization: "Bearer token", "content-type": "application/json" }, body: JSON.stringify(data),
});
beforeEach(() => { vi.resetAllMocks(); supabaseServer.mockReturnValue({ from, rpc }); });
describe("admin-only store settings", () => {
  it("saves booking rules only for the verified admin store", async () => {
    authorizeStaff.mockResolvedValue({ role: "admin", storeId: "verified-store" });
    rpc.mockResolvedValue({ data: { id: "verified-store" }, error: null });
    const response = await POST(new NextRequest("http://localhost/api/admin/settings", { method: "POST", body: JSON.stringify({ kind: "booking_rules", storeId: "other", data: { advance_days: 14, cutoff_minutes: 45 } }) }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("save_booking_rules_atomic", { p_store_id: "verified-store", p_advance_days: 14, p_cutoff_minutes: 45 });
  });
  it("rejects unauthenticated reads and writes", async () => {
    authorizeStaff.mockResolvedValue(null);
    expect((await GET(new NextRequest("http://localhost/api/admin/settings"))).status).toBe(401);
    expect((await POST(request())).status).toBe(401);
    expect(supabaseServer).not.toHaveBeenCalled();
  });
  it("does not let staff accounts read or change configuration", async () => {
    authorizeStaff.mockResolvedValue({ role: "staff", storeId: "store" });
    expect((await GET(new NextRequest("http://localhost/api/admin/settings"))).status).toBe(403);
    expect((await POST(request())).status).toBe(403);
    expect(supabaseServer).not.toHaveBeenCalled();
  });
  it("updates only the verified store through an atomic whitelisted RPC", async () => {
    authorizeStaff.mockResolvedValue({ role: "admin", storeId: "verified-store" });
    rpc.mockResolvedValue({ data: { id: "verified-store" }, error: null });
    const response = await POST(new NextRequest("http://localhost/api/admin/settings", { method: "POST", body: JSON.stringify({ kind: "store", storeId: "other-store", data: { name: " 新店舗 ", store_id: "other-store" } }) }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("save_store_settings_atomic", { p_store_id: "verified-store", p_kind: "store", p_data: { name: "新店舗" } });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("does not mutate for invalid input", async () => {
    authorizeStaff.mockResolvedValue({ role: "admin", storeId: "store" });
    expect((await POST(request({ kind: "store", data: { name: " " } }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("scopes reads and both sides of assignments to the verified store", async () => {
    authorizeStaff.mockResolvedValue({ role: "admin", storeId: "verified-store" });
    const queries: { table: string; eq: ReturnType<typeof vi.fn> }[] = [];
    from.mockImplementation(table => {
      const data = table === "stores" ? { id: "verified-store", name: "整体院", timezone: "Asia/Tokyo" }
        : table === "staff_services" ? [{ staff_id: "staff", service_id: "service", staff: { store_id: "verified-store" } }]
        : table === "business_hours" ? [{ weekday: 1, start_time: "09:00:00", end_time: "18:00:00" }] : [];
      const q = { table, select: vi.fn(), eq: vi.fn(), order: vi.fn(), single: vi.fn(), then: vi.fn() };
      q.select.mockReturnValue(q); q.eq.mockReturnValue(q); q.order.mockReturnValue(q);
      q.single.mockResolvedValue({ data, error: null });
      q.then.mockImplementation(resolve => resolve({ data, error: null }));
      queries.push(q); return q;
    });
    const response = await GET(new NextRequest("http://localhost/api/admin/settings"));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.links).toEqual([{ staff_id: "staff", service_id: "service" }]);
    expect(result.hours).toEqual([{ weekday: 1, start_time: "09:00", end_time: "18:00" }]);
    for (const q of queries) {
      if (q.table === "staff_services") {
        expect(q.eq).toHaveBeenCalledWith("staff.store_id", "verified-store");
        expect(q.eq).toHaveBeenCalledWith("services.store_id", "verified-store");
      } else expect(q.eq).toHaveBeenCalledWith(q.table === "stores" ? "id" : "store_id", "verified-store");
    }
  });
  it.each(["service_timing_has_reservations", "business_hours_have_reservations"])("reports reservation conflicts for %s without fallback writes", async message => {
    authorizeStaff.mockResolvedValue({ role: "admin", storeId: "store" });
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message } });
    expect((await POST(request())).status).toBe(409);
    expect(rpc).toHaveBeenCalledOnce();
  });
  it("reports a missing settings migration", async () => {
    authorizeStaff.mockResolvedValue({ role: "admin", storeId: "store" });
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Missing function" } });
    expect((await POST(request())).status).toBe(503);
  });
});
