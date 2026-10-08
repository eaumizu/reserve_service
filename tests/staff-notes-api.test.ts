import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { authorizeStaff, from, rpc, query, result } = vi.hoisted(() => ({ authorizeStaff: vi.fn(), from: vi.fn(), rpc: vi.fn(), query: { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() }, result: { value: {} as { data: unknown; error: unknown } } }));
vi.mock("../lib/admin-auth", () => ({ authorizeStaff }));
vi.mock("../lib/supabase-server", () => ({ supabaseServer: () => ({ from, rpc }) }));
import { GET, POST } from "../app/api/admin/reservations/[id]/note/route";
const id = "11111111-1111-4111-8111-111111111111";
const version = "22222222-2222-4222-8222-222222222222";
const context = { params: Promise.resolve({ id }) };
const request = (body?: unknown) => new NextRequest(`http://localhost/api/admin/reservations/${id}/note`, { method: body === undefined ? "GET" : "POST", headers: { authorization: "Bearer token" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
beforeEach(() => {
  vi.resetAllMocks(); authorizeStaff.mockResolvedValue({ storeId: "trusted-store", userId: "trusted-user", role: "staff" });
  from.mockReturnValue(query); query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data: { id }, error: null });
  result.value = { data: { note: "申し送り", version, updatedAt: "2030-01-01T00:00:00Z" }, error: null };
  rpc.mockImplementation(async () => result.value);
});
describe("private staff notes", () => {
  it("rejects unauthenticated reads and writes before DB access", async () => {
    authorizeStaff.mockResolvedValue(null);
    expect((await GET(request(), context)).status).toBe(401);
    expect((await POST(request({ note: "secret", expectedVersion: null }), context)).status).toBe(401);
    expect(from).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });
  it("verifies the reservation belongs to the staff store before reading a note", async () => {
    query.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await GET(request(), context)).status).toBe(404);
    expect(from).toHaveBeenCalledExactlyOnceWith("reservations");
    expect(query.eq).toHaveBeenCalledWith("store_id", "trusted-store");
  });
  it("returns an empty first note with a null version and private cache policy", async () => {
    query.maybeSingle.mockResolvedValueOnce({ data: { id }, error: null }).mockResolvedValueOnce({ data: null, error: null });
    const response = await GET(request(), context);
    expect(await response.json()).toEqual({ note: "", version: null, updatedAt: null });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(query.eq).toHaveBeenCalledWith("reservation_id", id);
  });
  it("returns existing staff notes without exposing updater IDs", async () => {
    query.maybeSingle.mockResolvedValueOnce({ data: { id }, error: null }).mockResolvedValueOnce({ data: { note: "申し送り\n2行目", version, updated_at: "2030-01-01T00:00:00Z", updated_by: "private-user" }, error: null });
    const response = await GET(request(), context);
    expect(await response.json()).toEqual({ note: "申し送り\n2行目", version, updatedAt: "2030-01-01T00:00:00Z" });
  });
  it("uses only the authenticated store and user in an atomic versioned write", async () => {
    const response = await POST(request({ note: "申し送り", expectedVersion: version, storeId: "other", userId: "other" }), context);
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("save_reservation_staff_note_atomic", { p_store_id: "trusted-store", p_reservation_id: id, p_note: "申し送り", p_expected_version: version, p_user_id: "trusted-user" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("allows clearing a note without deleting its version record", async () => {
    expect((await POST(request({ note: "", expectedVersion: version }), context)).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ p_note: "", p_expected_version: version }));
  });
  it.each([{ note: "a".repeat(2001), expectedVersion: null }, { note: "text" }, { note: "text", expectedVersion: "bad" }, { note: 123, expectedVersion: null }])("rejects invalid edits %j", async body => {
    expect((await POST(request(body), context)).status).toBe(400); expect(rpc).not.toHaveBeenCalled();
  });
  it.each([["staff_note_changed", 409], ["reservation_not_found", 404], ["invalid_staff_note", 400]])("maps %s without overwriting or leaking errors", async (message, status) => {
    result.value = { data: null, error: { message, code: "P0001" } };
    expect((await POST(request({ note: "draft", expectedVersion: version }), context)).status).toBe(status);
  });
  it("reports missing SQL without breaking the other reservation endpoints", async () => {
    result.value = { data: null, error: { code: "PGRST202", message: "missing" } };
    const response = await POST(request({ note: "draft", expectedVersion: null }), context);
    expect(response.status).toBe(503); expect((await response.json()).error).toContain("0009");
  });
  it("does not leak database details on read or write failures", async () => {
    query.maybeSingle.mockResolvedValue({ data: null, error: { message: "private-db-detail" } });
    result.value = { data: null, error: { code: "08006", message: "private-db-detail" } };
    expect(await (await GET(request(), context)).text()).not.toContain("private-db-detail");
    expect(await (await POST(request({ note: "draft", expectedVersion: null }), context)).text()).not.toContain("private-db-detail");
  });
});
