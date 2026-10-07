import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { authorizeStaff, supabaseServer, from, rpc } = vi.hoisted(() => ({ authorizeStaff: vi.fn(), supabaseServer: vi.fn(), from: vi.fn(), rpc: vi.fn() }));
vi.mock("../lib/admin-auth", () => ({ authorizeStaff }));
vi.mock("../lib/supabase-server", () => ({ supabaseServer }));
import { GET, POST, DELETE } from "../app/api/admin/blocks/route";
const blockId = "55555555-5555-5555-5555-555555555555";
const body = { staffId: null, startDate: "2030-01-01", endDate: "2030-01-01", startTime: "12:00", endTime: "13:00", reason: "休憩" };
const request = (data: unknown = body, method = "POST") => new NextRequest("http://localhost/api/admin/blocks", { method, body: JSON.stringify(data), headers: { authorization: "Bearer token" } });
const read = (date = "2030-01-01") => new NextRequest(`http://localhost/api/admin/blocks?date=${date}`);
beforeEach(() => { vi.resetAllMocks(); authorizeStaff.mockResolvedValue({ role: "admin", storeId: "verified-store" }); supabaseServer.mockReturnValue({ from, rpc }); });
describe("admin-only availability blocks", () => {
  it.each([null, { role: "staff", storeId: "store" }])("rejects unauthorized reads and mutations: %j", async user => {
    authorizeStaff.mockResolvedValue(user);
    const status = user ? 403 : 401;
    expect((await GET(read())).status).toBe(status);
    expect((await POST(request())).status).toBe(status);
    expect((await DELETE(request({ blockId }, "DELETE"))).status).toBe(status);
    expect(supabaseServer).not.toHaveBeenCalled();
  });
  it("whitelists Japan-time creation for the authenticated store", async () => {
    rpc.mockResolvedValue({ data: { id: blockId }, error: null });
    const response = await POST(request({ ...body, storeId: "other", blockId, source: "web" }));
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("manage_availability_block_atomic", { p_store_id: "verified-store", p_action: "create", p_block_id: null,
      p_staff_id: null, p_start_at: "2030-01-01T03:00:00.000Z", p_end_at: "2030-01-01T04:00:00.000Z", p_reason: "休憩" });
  });
  it("deletes only the supplied block under verified store scope", async () => {
    rpc.mockResolvedValue({ data: { id: blockId }, error: null });
    expect((await DELETE(request({ blockId, storeId: "other", staffId: blockId }, "DELETE"))).status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("manage_availability_block_atomic", { p_store_id: "verified-store", p_action: "delete", p_block_id: blockId,
      p_staff_id: null, p_start_at: null, p_end_at: null, p_reason: null });
  });
  it("rejects malformed dates, IDs and JSON without writes", async () => {
    expect((await GET(read("2030-02-30"))).status).toBe(400);
    expect((await POST(request({ ...body, startTime: "12:01" }))).status).toBe(400);
    expect((await DELETE(request({ blockId: "bad" }, "DELETE"))).status).toBe(400);
    expect((await POST(new NextRequest("http://localhost/api/admin/blocks", { method: "POST", body: "{" }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
  it.each([
    ["P0001", "block_has_reservations", 409], ["P0001", "block_not_found", 404],
    ["P0001", "invalid_staff", 400], ["P0001", "invalid_block", 400], ["PGRST202", "Missing RPC", 503], ["XX000", "unavailable", 503],
  ])("handles DB %s %s as %s without fallback writes", async (code, message, status) => {
    rpc.mockResolvedValue({ data: null, error: { code, message } });
    expect((await POST(request())).status).toBe(status);
    expect(rpc).toHaveBeenCalledOnce();
    expect(from).not.toHaveBeenCalled();
  });
  it("includes overnight blocks for the selected Japan-time day with bounded results", async () => {
    const queries: { table: string; eq: ReturnType<typeof vi.fn>; lt: ReturnType<typeof vi.fn>; gt: ReturnType<typeof vi.fn>; limit: ReturnType<typeof vi.fn> }[] = [];
    from.mockImplementation(table => {
      const q = { table, select: vi.fn(), eq: vi.fn(), lt: vi.fn(), gt: vi.fn(), order: vi.fn(), limit: vi.fn(), then: vi.fn() };
      for (const method of [q.select, q.eq, q.lt, q.gt, q.order, q.limit]) method.mockReturnValue(q);
      q.then.mockImplementation(resolve => resolve({ error: null, data: table === "availability_blocks" ? Array.from({ length: 201 }, () => ({ id: blockId })) : [] }));
      queries.push(q); return q;
    });
    const response = await GET(read());
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.blocks).toHaveLength(200); expect(result.truncated).toBe(true);
    for (const q of queries) expect(q.eq).toHaveBeenCalledWith("store_id", "verified-store");
    expect(queries[0].lt).toHaveBeenCalledWith("start_at", "2030-01-01T15:00:00.000Z");
    expect(queries[0].gt).toHaveBeenCalledWith("end_at", "2029-12-31T15:00:00.000Z");
    expect(queries[0].limit).toHaveBeenCalledWith(201);
  });
  it("fails closed if a read fails", async () => {
    from.mockImplementation(() => {
      const q = { select: vi.fn(), eq: vi.fn(), lt: vi.fn(), gt: vi.fn(), order: vi.fn(), limit: vi.fn(), then: vi.fn() };
      for (const method of [q.select, q.eq, q.lt, q.gt, q.order, q.limit]) method.mockReturnValue(q);
      q.then.mockImplementation(resolve => resolve({ data: null, error: { message: "DB failed" } }));
      return q;
    });
    expect((await GET(read())).status).toBe(503);
  });
});
