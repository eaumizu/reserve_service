import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { query, rpc } = vi.hoisted(() => ({ query: { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() }, rpc: vi.fn() }));
vi.mock("../lib/supabase-server", () => ({ supabaseServer: () => ({ from: () => query, rpc }) }));
import { readBookingRules } from "../lib/booking-rules-server";
import { POST } from "../app/api/reservations/route";
import { GET } from "../app/api/booking-rules/route";
const payload = { storeId: "trusted", serviceId: "service", staffId: "staff", customerName: "確認用", customerPhone: "000", source: "web", startAt: "2030-01-01T11:00:00+09:00" };
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("NEXT_PUBLIC_DEFAULT_STORE_ID", "trusted");
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2030-01-01T10:00:00+09:00"));
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data: { advance_days: 30, cutoff_minutes: 60 }, error: null });
  rpc.mockResolvedValue({ data: { id: "reservation" }, error: null });
});
const post = (startAt = payload.startAt) => POST(new NextRequest("http://localhost/api/reservations", { method: "POST", body: JSON.stringify({ ...payload, startAt }) }));
describe("public booking rules API", () => {
  it("saves optional email in the atomic booking call", async () => {
    const response = await POST(new NextRequest("http://localhost/api/reservations", { method: "POST", body: JSON.stringify({ ...payload, customerEmail: " Test@example.com " }) }));
    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("create_reservation_with_email_atomic", expect.objectContaining({ p_customer_email: "Test@example.com", p_store_id: "trusted", p_source: "web" }));
  });
  it("rejects invalid email before creating a reservation", async () => {
    const response = await POST(new NextRequest("http://localhost/api/reservations", { method: "POST", body: JSON.stringify({ ...payload, customerEmail: "bad" }) }));
    expect(response.status).toBe(400); expect(rpc).not.toHaveBeenCalled();
  });
  it("does not discard email when the migration is absent", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "private schema detail" } });
    const response = await POST(new NextRequest("http://localhost/api/reservations", { method: "POST", body: JSON.stringify({ ...payload, customerEmail: "test@example.com" }) }));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("private schema detail");
    expect(rpc).toHaveBeenCalledOnce();
  });
  it("rejects a slot that expired after display without creating records", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2030-01-01T10:00:01+09:00"));
    expect((await post()).status).toBe(409); expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects dates beyond the reception period", async () => {
    expect((await post("2030-02-01T12:00:00+09:00")).status).toBe(409); expect(rpc).not.toHaveBeenCalled();
  });
  it("accepts an exact cutoff and scopes the rules read to the configured store", async () => {
    expect((await post()).status).toBe(201); expect(query.eq).toHaveBeenCalledWith("id", "trusted");
  });
  it("handles a DB rejection after waiting for locks", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "booking_window_closed" } });
    const result = await post(); expect(result.status).toBe(409); expect((await result.json()).error).toContain("締め切り");
  });
  it("returns only public rules and Japan-date bounds without caching", async () => {
    const response = await GET(); expect(await response.json()).toEqual({ advance_days: 30, cutoff_minutes: 60, minDate: "2030-01-01", maxDate: "2030-01-31" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("uses defaults only for missing migration columns, failing closed on outages", async () => {
    query.maybeSingle.mockResolvedValue({ data: null, error: { code: "42703" } });
    expect(await readBookingRules("trusted")).toEqual({ advance_days: 30, cutoff_minutes: 60 });
    query.maybeSingle.mockResolvedValue({ data: null, error: { code: "08006", message: "private" } });
    expect((await post()).status).toBe(500); expect(rpc).not.toHaveBeenCalled();
    expect((await GET()).status).toBe(503);
  });
});
