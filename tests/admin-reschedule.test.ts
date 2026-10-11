const {notify}=vi.hoisted(()=>({notify:vi.fn()}));
vi.mock("../lib/line-reservation-events",()=>({dispatchLineReservationEvents:notify,LINE_EVENT_WARNING:"pending"}));
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { authorizeStaff, supabaseServer, rpc } = vi.hoisted(() => ({ authorizeStaff: vi.fn(), supabaseServer: vi.fn(), rpc: vi.fn() }));
vi.mock("../lib/admin-auth", () => ({ authorizeStaff }));
vi.mock("../lib/supabase-server", () => ({ supabaseServer }));
import { POST } from "../app/api/admin/reservations/reschedule/route";
const input = {
  reservationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", staffId: "22222222-2222-2222-2222-222222222222",
  startAt: "2030-01-01T10:30:00+09:00", expectedUpdatedAt: "2026-10-06T01:00:00.123456Z",
};
const request = (body: unknown) => POST(new NextRequest("http://localhost/api/admin/reservations/reschedule", {
  method: "POST", headers: { authorization: "Bearer token", "content-type": "application/json" }, body: JSON.stringify(body),
}));
beforeEach(() => { vi.resetAllMocks();notify.mockResolvedValue({pending:false}); supabaseServer.mockReturnValue({ rpc }); });
describe("atomic reservation changes", () => {
  it.each(["15", "45"])("accepts rescheduling to minute %s", async minute => {
    authorizeStaff.mockResolvedValue({ storeId: "verified-store" });
    const startAt = `2030-01-01T10:${minute}:00+09:00`;
    rpc.mockResolvedValue({ data: { id: input.reservationId, start_at: startAt, staff_id: input.staffId }, error: null });
    expect((await request({ ...input, startAt })).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("reschedule_reservation_atomic", expect.objectContaining({ p_start_at: startAt }));
  });
  it("blocks unauthenticated changes without a DB call", async () => {
    authorizeStaff.mockResolvedValue(null);
    expect((await request(input)).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([null, { staffId: "bad" }, { startAt: "2030-01-01T10:05:00+09:00" }, { startAt: "2030-01-01T10:30:01+09:00" }, { expectedUpdatedAt: undefined }])("rejects malformed, off-grid or unversioned changes", async invalid => {
    authorizeStaff.mockResolvedValue({ storeId: "verified-store" });
    expect((await request(invalid === null ? null : { ...input, ...invalid })).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("uses one DB transaction and trusts only the verified store, preserving timestamp precision", async () => {
    authorizeStaff.mockResolvedValue({ storeId: "verified-store" });
    rpc.mockResolvedValue({ data: { id: input.reservationId, staff_id: input.staffId, start_at: input.startAt }, error: null });
    const response = await request({ ...input, storeId: "other-store", customerName: "tampered", status: "cancelled" });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("reschedule_reservation_atomic", {
      p_store_id: "verified-store", p_reservation_id: input.reservationId,
      p_staff_id: input.staffId, p_start_at: input.startAt, p_expected_updated_at: input.expectedUpdatedAt,
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it.each(["reservation_changed", "time_slot_unavailable", "outside_business_hours", "invalid_staff_service"])("does not retry or cancel the original on %s", async message => {
    authorizeStaff.mockResolvedValue({ storeId: "verified-store" });
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message } });
    expect((await request(input)).status).toBe(409);
    expect(rpc).toHaveBeenCalledOnce();
  });
  it("returns 404 for another-store or missing reservation", async () => {
    authorizeStaff.mockResolvedValue({ storeId: "verified-store" });
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "reservation_not_found" } });
    expect((await request(input)).status).toBe(404);
  });
  it("explains a missing migration without attempting an unsafe fallback", async () => {
    authorizeStaff.mockResolvedValue({ storeId: "verified-store" });
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Missing function" } });
    const response = await request(input);
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("DB設定が未適用");
    expect(rpc).toHaveBeenCalledOnce();
  });
});

it("keeps a staff reschedule successful and surfaces pending LINE delivery",async()=>{authorizeStaff.mockResolvedValue({storeId:"trusted"});supabaseServer.mockReturnValue({rpc});rpc.mockResolvedValue({data:{id:input.reservationId,staff_id:input.staffId,start_at:input.startAt},error:null});notify.mockResolvedValue({pending:true});const r=await request(input);expect(r.status).toBe(200);expect((await r.json()).notificationWarning).toBe("pending");expect(notify).toHaveBeenCalledWith("trusted",input.reservationId);});
