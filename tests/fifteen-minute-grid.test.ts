vi.mock("../lib/booking-rules-server", () => ({ readBookingRules: async () => ({ advance_days: 30, cutoff_minutes: 60 }) }));
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { findAvailableStarts } from "../lib/reservations/availability";
import { CLOCK_TIMES, isGridTimestamp, isPublicBookingStart } from "../lib/reservations/time-grid";
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../lib/supabase-server", () => ({ supabaseServer: () => ({ rpc }) }));
import { POST } from "../app/api/reservations/route";
beforeEach(() => { vi.resetAllMocks(); vi.spyOn(Date, "now").mockReturnValue(Date.parse("2029-12-31T00:00:00Z")); vi.stubEnv("NEXT_PUBLIC_DEFAULT_STORE_ID", "store"); });
describe("separate operational and public booking grids", () => {
  it("offers 10:30 after a one-hour treatment and 15-minute cleanup, retaining the cleanup", () => {
    const date = (time: string) => new Date(`2030-01-01T${time}:00+09:00`);
    const starts = findAvailableStarts({ open: [{ start: date("09:00"), end: date("12:00") }], occupied: [{ start: date("09:00"), end: date("10:15") }], durationMinutes: 60, bufferBefore: 0, bufferAfter: 15 });
    expect(starts.map(s => s.toISOString()).filter(isPublicBookingStart)).toEqual([date("10:30").toISOString()]);
    expect(CLOCK_TIMES).toContain("10:15");
  });
  it.each(["00", "30"])("accepts public start minute %s without rounding the timestamp", async minute => {
    const startAt = `2030-01-01T10:${minute}:00+09:00`;
    rpc.mockImplementation(async (name: string) => ({ data: name === "store_calendar_credentials" ? null : { id: "reservation" }, error: null }));
    const r = await POST(new NextRequest("http://localhost/api/reservations", { method: "POST", body: JSON.stringify({ source: "web", storeId: "store", serviceId: "service", staffId: "staff", customerName: "確認", customerEmail: "guest@example.com", customerPhone: "", startAt }) }));
    expect(r.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("create_customer_booking_atomic", expect.objectContaining({ p_start_at: startAt }));
  });
  it("checks the instant in Japan rather than trusting the posted offset's minute digits", () => {
    expect(isPublicBookingStart("2030-01-01T10:00:00+09:15")).toBe(false);
    expect(isPublicBookingStart("2030-01-01T10:15:00+08:45")).toBe(true);
    expect(isPublicBookingStart("2030-01-01T10:30:01+09:00")).toBe(false);
  });
  it("offers 10:15 after a 9:00 one-hour treatment with 15-minute cleanup", () => {
    const date = (time: string) => new Date(`2030-01-01T${time}:00+09:00`);
    const slots = findAvailableStarts({ open: [{ start: date("09:00"), end: date("12:00") }],
      occupied: [{ start: date("09:00"), end: date("10:15") }], durationMinutes: 60, bufferBefore: 0, bufferAfter: 15 });
    expect(slots.map(s => s.toISOString())).toEqual([date("10:15"), date("10:30"), date("10:45")].map(d => d.toISOString()));
    expect(CLOCK_TIMES).toContain("10:15"); expect(CLOCK_TIMES).toContain("23:45");
  });
  it.each(["15", "45"])("rejects public booking at minute %s", async minute => {
    const startAt = `2030-01-01T10:${minute}:00+09:00`;
    rpc.mockImplementation(async (name: string) => ({ data: name === "store_calendar_credentials" ? null : { id: "reservation" }, error: null }));
    const response = await POST(new NextRequest("http://localhost/api/reservations", { method: "POST", body: JSON.stringify({ source: "web", storeId: "store", serviceId: "service", staffId: "staff", customerName: "確認", customerEmail:"guest@example.com",customerPhone: "000", startAt }) }));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    expect(isGridTimestamp(startAt)).toBe(true);
  });
  it.each(["2030-01-01T10:10:00+09:00", "2030-01-01T10:15:01+09:00", "2030-01-01T10:15:00", "invalid"])("rejects invalid public starts %s", async startAt => {
    expect(isGridTimestamp(startAt)).toBe(false);
    const response = await POST(new NextRequest("http://localhost/api/reservations", { method: "POST", body: JSON.stringify({ source: "web", storeId: "store", customerName: "確認", customerEmail:"guest@example.com",customerPhone: "000", startAt }) }));
    expect(response.status).toBe(400); expect(rpc).not.toHaveBeenCalled();
  });
});
