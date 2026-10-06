import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { authorizeStaff, supabaseServer, query, rpc } = vi.hoisted(() => ({
  authorizeStaff: vi.fn(), supabaseServer: vi.fn(), rpc: vi.fn(),
  query: { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), update: vi.fn(), maybeSingle: vi.fn() },
}));
vi.mock("../lib/admin-auth", () => ({ authorizeStaff }));
vi.mock("../lib/supabase-server", () => ({ supabaseServer }));
import { GET, POST, PATCH } from "../app/api/admin/reservations/route";

beforeEach(() => {
  vi.resetAllMocks();
  supabaseServer.mockReturnValue({ from: () => query, rpc });
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.order.mockReturnValue(query);
  query.update.mockReturnValue(query);
});

const reservationId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
function patch(body: unknown) {
  return PATCH(new NextRequest("http://localhost/api/admin/reservations", {
    method: "PATCH", headers: { authorization: "Bearer token", "content-type": "application/json" }, body: JSON.stringify(body),
  }));
}
describe("reservation cancellation", () => {
  it("rejects an unauthenticated cancellation without touching the DB", async () => {
    authorizeStaff.mockResolvedValue(null);
    expect((await patch({ reservationId, status: "cancelled" })).status).toBe(401);
    expect(supabaseServer).not.toHaveBeenCalled();
  });
  it.each([null, {}, { reservationId: "bad-id", status: "cancelled" }, { reservationId, status: "confirmed" }, { reservationId, status: "completed" }])("rejects invalid requests and arbitrary status transitions", async body => {
    authorizeStaff.mockResolvedValue({ storeId });
    expect((await patch(body)).status).toBe(400);
    expect(query.update).not.toHaveBeenCalled();
  });
  it("atomically scopes cancellation to the verified store and confirmed status, retaining the record", async () => {
    authorizeStaff.mockResolvedValue({ storeId });
    query.maybeSingle.mockResolvedValue({ data: { id: reservationId, status: "cancelled" }, error: null });
    const response = await patch({ reservationId, status: "cancelled", storeId: "untrusted-store", customerName: "tampered" });
    expect(response.status).toBe(200);
    const update = query.update.mock.calls[0][0];
    expect(update).toEqual({ status: "cancelled", updated_at: expect.any(String) });
    expect(Number.isFinite(Date.parse(update.updated_at))).toBe(true);
    expect(query.eq.mock.calls).toEqual([["id", reservationId], ["store_id", storeId], ["status", "confirmed"]]);
    expect(query.maybeSingle).toHaveBeenCalledOnce();
    expect(await response.json()).toEqual({ reservation: { id: reservationId, status: "cancelled" } });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("returns a generic conflict for another store, missing reservation or changed status", async () => {
    authorizeStaff.mockResolvedValue({ storeId });
    query.maybeSingle.mockResolvedValue({ data: null, error: null });
    const response = await patch({ reservationId, status: "cancelled" });
    expect(response.status).toBe(409);
    expect(await response.json()).not.toHaveProperty("reservation");
  });
  it("does not expose internal database errors", async () => {
    authorizeStaff.mockResolvedValue({ storeId });
    query.maybeSingle.mockResolvedValue({ data: null, error: { message: "private database detail" } });
    const response = await patch({ reservationId, status: "cancelled" });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private database detail");
  });
});

const storeId = "11111111-1111-1111-1111-111111111111";
const input = { storeId, serviceId: "55555555-5555-5555-5555-555555555555", staffId: "22222222-2222-2222-2222-222222222222", startAt: "2030-01-01T10:00:00+09:00", customerName: " 確認用 ", customerPhone: " 09000000000 ", source: "phone" };
function post(body: unknown) {
  return POST(new NextRequest("http://localhost/api/admin/reservations", {
    method: "POST", headers: { authorization: "Bearer token", "content-type": "application/json" }, body: JSON.stringify(body),
  }));
}
describe("manual booking API", () => {
  it("rejects unauthenticated booking without writing", async () => {
    authorizeStaff.mockResolvedValue(null);
    expect((await post(input)).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects booking into another store", async () => {
    authorizeStaff.mockResolvedValue({ storeId });
    expect((await post({ ...input, storeId: "other-store" })).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([{ customerName: " " }, { customerPhone: 123 }, { staffId: "bad-id" }, { startAt: "2030-01-01T10:00" }, { note: {} }])("rejects invalid input before writing", async invalid => {
    authorizeStaff.mockResolvedValue({ storeId });
    expect((await post({ ...input, ...invalid })).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(["phone", "walk_in", "admin"])("creates %s booking through the atomic DB function", async source => {
    authorizeStaff.mockResolvedValue({ storeId });
    rpc.mockResolvedValue({ data: { id: "reservation" }, error: null });
    expect((await post({ ...input, source })).status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("create_reservation_atomic", expect.objectContaining({
      p_store_id: storeId, p_source: source, p_start_at: "2030-01-01T10:00:00+09:00", p_customer_name: "確認用", p_customer_phone: "09000000000",
    }));
  });
  it.each(["outside_business_hours", "time_slot_unavailable"])("rejects %s from database validation", async message => {
    authorizeStaff.mockResolvedValue({ storeId });
    rpc.mockResolvedValue({ data: null, error: { message } });
    const response = await post(input);
    expect(response.status).toBe(409);
    expect(await response.json()).not.toHaveProperty("reservation");
  });
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
