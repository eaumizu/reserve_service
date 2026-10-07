import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { authorizeStaff, supabaseServer, query, roster, rpc } = vi.hoisted(() => ({
  authorizeStaff: vi.fn(), supabaseServer: vi.fn(), rpc: vi.fn(),
  query: { select: vi.fn(), eq: vi.fn(), gte: vi.fn(), lt: vi.fn(), lte: vi.fn(), order: vi.fn(), range: vi.fn(), update: vi.fn(), maybeSingle: vi.fn() },
  roster: { select: vi.fn(), eq: vi.fn(), order: vi.fn(), then: vi.fn() },
}));
vi.mock("../lib/admin-auth", () => ({ authorizeStaff }));
vi.mock("../lib/supabase-server", () => ({ supabaseServer }));
import { GET, POST, PATCH } from "../app/api/admin/reservations/route";

beforeEach(() => {
  vi.resetAllMocks();
  supabaseServer.mockReturnValue({ from: (table: string) => table === "staff" ? roster : query, rpc });
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.order.mockReturnValue(query);
  query.gte.mockReturnValue(query); query.lt.mockReturnValue(query); query.lte.mockReturnValue(query);
  query.range.mockResolvedValue({ data: [], error: null });
  roster.select.mockReturnValue(roster); roster.eq.mockReturnValue(roster); roster.order.mockReturnValue(roster);
  roster.then.mockImplementation(resolve => resolve({ data: [], error: null }));
  query.update.mockReturnValue(query);
});

const reservationId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
function patch(body: unknown) {
  return PATCH(new NextRequest("http://localhost/api/admin/reservations", {
    method: "PATCH", headers: { authorization: "Bearer token", "content-type": "application/json" }, body: JSON.stringify(body),
  }));
}
describe("reservation cancellation", () => {
  it("uses the displayed version for cancellation when supplied", async () => {
    authorizeStaff.mockResolvedValue({ storeId });
    query.maybeSingle.mockResolvedValue({ data: { id: reservationId, status: "cancelled" }, error: null });
    const expectedUpdatedAt = "2030-01-01T00:00:00.123456Z";
    expect((await patch({ reservationId, status: "cancelled", expectedUpdatedAt })).status).toBe(200);
    expect(query.eq).toHaveBeenCalledWith("updated_at", expectedUpdatedAt);
  });
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

describe("recording attendance outcomes", () => {
  const expectedUpdatedAt = "2030-01-01T00:00:00.123456Z";
  it.each(["completed", "no_show"])("requires authorization for %s", async status => {
    authorizeStaff.mockResolvedValue(null);
    expect((await patch({ reservationId, status, expectedUpdatedAt })).status).toBe(401);
    expect(supabaseServer).not.toHaveBeenCalled();
  });
  it.each(["completed", "no_show"])("requires a valid displayed version for %s", async status => {
    authorizeStaff.mockResolvedValue({ storeId });
    expect((await patch({ reservationId, status })).status).toBe(400);
    expect((await patch({ reservationId, status, expectedUpdatedAt: "invalid" })).status).toBe(400);
    expect(query.update).not.toHaveBeenCalled();
  });
  it("records no-show only after the start, atomically checking store, status and version", async () => {
    authorizeStaff.mockResolvedValue({ storeId });
    query.maybeSingle.mockResolvedValue({ data: { id: reservationId, status: "no_show" }, error: null });
    const before = Date.now();
    expect((await patch({ reservationId, status: "no_show", expectedUpdatedAt, storeId: "other" })).status).toBe(200);
    expect(query.eq.mock.calls).toEqual([["id", reservationId], ["store_id", storeId], ["status", "confirmed"], ["updated_at", expectedUpdatedAt]]);
    expect(query.update).toHaveBeenCalledWith({ status: "no_show", updated_at: expect.any(String) });
    const [column, cutoff] = query.lte.mock.calls[0];
    expect(column).toBe("start_at"); expect(Date.parse(cutoff)).toBeGreaterThanOrEqual(before); expect(Date.parse(cutoff)).toBeLessThanOrEqual(Date.now());
  });
  it("preserves cleanup when recording completion, checking the cutoff in the atomic update", async () => {
    authorizeStaff.mockResolvedValue({ storeId });
    query.maybeSingle.mockResolvedValueOnce({ data: { services: { buffer_after: 15 } }, error: null })
      .mockResolvedValueOnce({ data: { id: reservationId, status: "completed" }, error: null });
    const before = Date.now();
    expect((await patch({ reservationId, status: "completed", expectedUpdatedAt })).status).toBe(200);
    expect(query.select).toHaveBeenCalledWith("services(buffer_after)");
    expect(query.eq).toHaveBeenCalledWith("store_id", storeId); expect(query.eq).toHaveBeenCalledWith("updated_at", expectedUpdatedAt);
    const [column, cutoff] = query.lte.mock.calls[0];
    expect(column).toBe("end_at"); expect(Date.parse(cutoff)).toBeGreaterThanOrEqual(before - 15 * 60000);
    expect(Date.parse(cutoff)).toBeLessThanOrEqual(Date.now() - 15 * 60000);
    expect(query.update).toHaveBeenCalledWith({ status: "completed", updated_at: expect.any(String) });
  });
  it.each(["completed", "no_show"])("returns a conflict for a future, stale or already recorded %s", async status => {
    authorizeStaff.mockResolvedValue({ storeId });
    if (status === "completed") query.maybeSingle.mockResolvedValueOnce({ data: { services: { buffer_after: 15 } }, error: null });
    query.maybeSingle.mockResolvedValue({ data: null, error: null });
    const response = await patch({ reservationId, status, expectedUpdatedAt });
    expect(response.status).toBe(409); expect(await response.json()).not.toHaveProperty("reservation");
    expect(query.update).toHaveBeenCalledOnce();
  });
  it("does not update if completion details were changed or cannot be read", async () => {
    authorizeStaff.mockResolvedValue({ storeId });
    query.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await patch({ reservationId, status: "completed", expectedUpdatedAt })).status).toBe(409);
    query.maybeSingle.mockResolvedValue({ data: null, error: { message: "private DB error" } });
    const response = await patch({ reservationId, status: "completed", expectedUpdatedAt });
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("private DB error");
    expect(query.update).not.toHaveBeenCalled();
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
  it.each(["15", "45"])("accepts a start at minute %s", async minute => {
    authorizeStaff.mockResolvedValue({ storeId });
    rpc.mockResolvedValue({ data: { id: "reservation" }, error: null });
    const startAt = `2030-01-01T10:${minute}:00+09:00`;
    expect((await post({ ...input, startAt })).status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("create_reservation_atomic", expect.objectContaining({ p_start_at: startAt }));
  });
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
  it.each(["2030-01-01T10:05:00+09:00", "2030-01-01T10:00:01+09:00"])("rejects minute/second offsets outside 15-minute starts", async startAt => {
    authorizeStaff.mockResolvedValue({ storeId });
    expect((await post({ ...input, startAt })).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
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
    query.range.mockResolvedValue({ data: [], error: null });
    const response = await GET(new NextRequest("http://localhost/api/admin/reservations?storeId=other-store", { headers: { authorization: "Bearer token" } }));
    expect(response.status).toBe(200);
    expect(query.eq).toHaveBeenCalledWith("store_id", "trusted-store");
    expect(await response.json()).toEqual({ reservations: [], staff: [], hasMore: false, canManageSettings: false });
  });
  it("does not expose database errors or partial records", async () => {
    authorizeStaff.mockResolvedValue({ storeId: "trusted-store" });
    query.range.mockResolvedValue({ data: [{ id: "secret" }], error: { message: "private database error" } });
    const response = await GET(new NextRequest("http://localhost/api/admin/reservations"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/secret|private database error/);
  });
  it("filters by Japan-time date and staff before paging in stable start order", async () => {
    authorizeStaff.mockResolvedValue({ storeId, role: "admin" });
    const staffId = "22222222-2222-2222-2222-222222222222";
    query.range.mockResolvedValue({ data: Array.from({ length: 101 }, (_, id) => ({ id })), error: null });
    roster.then.mockImplementation(resolve => resolve({ data: [{ id: staffId, name: "担当", active: false }], error: null }));
    const response = await GET(new NextRequest(`http://localhost/api/admin/reservations?date=2030-01-01&staffId=${staffId}&page=1`));
    expect(response.status).toBe(200);
    expect(query.gte).toHaveBeenCalledWith("start_at", "2029-12-31T15:00:00.000Z");
    expect(query.lt).toHaveBeenCalledWith("start_at", "2030-01-01T15:00:00.000Z");
    expect(query.eq).toHaveBeenCalledWith("staff_id", staffId);
    expect(query.order.mock.calls).toEqual([["start_at", { ascending: true }], ["id", { ascending: true }]]);
    expect(query.range).toHaveBeenCalledWith(100, 200);
    expect(roster.eq.mock.calls).toEqual([["store_id", storeId]]);
    const result = await response.json();
    expect(result.reservations).toHaveLength(100); expect(result.hasMore).toBe(true);
    expect(result.canManageSettings).toBe(true); expect(result.staff[0].active).toBe(false);
  });
  it("has no next page for exactly 100 matching records", async () => {
    authorizeStaff.mockResolvedValue({ storeId });
    query.range.mockResolvedValue({ data: Array.from({ length: 100 }, (_, id) => ({ id })), error: null });
    const response = await GET(new NextRequest("http://localhost/api/admin/reservations"));
    expect((await response.json()).hasMore).toBe(false);
    expect(query.gte).not.toHaveBeenCalled(); expect(query.lt).not.toHaveBeenCalled();
  });
  it.each(["date=2030-02-30", "date=", "staffId=bad", "page=-1", "page=1.5", "page=10001"])("rejects invalid filters %s before DB reads", async params => {
    authorizeStaff.mockResolvedValue({ storeId });
    expect((await GET(new NextRequest(`http://localhost/api/admin/reservations?${params}`))).status).toBe(400);
    expect(supabaseServer).not.toHaveBeenCalled();
  });
  it("fails closed when the staff roster cannot be fetched", async () => {
    authorizeStaff.mockResolvedValue({ storeId });
    roster.then.mockImplementation(resolve => resolve({ data: null, error: { message: "private roster detail" } }));
    const response = await GET(new NextRequest("http://localhost/api/admin/reservations"));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("private roster detail");
  });
});
