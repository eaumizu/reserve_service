import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { findAvailableStarts } from "../lib/reservations/availability";
import { CLOCK_TIMES, isGridTimestamp } from "../lib/reservations/time-grid";
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../lib/supabase-server", () => ({ supabaseServer: () => ({ rpc }) }));
import { POST } from "../app/api/reservations/route";
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("NEXT_PUBLIC_DEFAULT_STORE_ID", "store"); });
describe("quarter-hour booking end to end boundaries", () => {
  it("offers 10:15 after a 9:00 one-hour treatment with 15-minute cleanup", () => {
    const date = (time: string) => new Date(`2030-01-01T${time}:00+09:00`);
    const slots = findAvailableStarts({ open: [{ start: date("09:00"), end: date("12:00") }],
      occupied: [{ start: date("09:00"), end: date("10:15") }], durationMinutes: 60, bufferBefore: 0, bufferAfter: 15 });
    expect(slots.map(s => s.toISOString())).toEqual([date("10:15"), date("10:30"), date("10:45")].map(d => d.toISOString()));
    expect(CLOCK_TIMES).toContain("10:15"); expect(CLOCK_TIMES).toContain("23:45");
  });
  it.each(["15", "45"])("allows public booking at minute %s", async minute => {
    const startAt = `2030-01-01T10:${minute}:00+09:00`;
    rpc.mockResolvedValue({ data: { id: "reservation" }, error: null });
    const response = await POST(new NextRequest("http://localhost/api/reservations", { method: "POST", body: JSON.stringify({ source: "web", storeId: "store", serviceId: "service", staffId: "staff", customerName: "確認", customerPhone: "000", startAt }) }));
    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("create_reservation_atomic", expect.objectContaining({ p_start_at: startAt }));
  });
  it.each(["2030-01-01T10:10:00+09:00", "2030-01-01T10:15:01+09:00", "2030-01-01T10:15:00", "invalid"])("rejects invalid public starts %s", async startAt => {
    expect(isGridTimestamp(startAt)).toBe(false);
    const response = await POST(new NextRequest("http://localhost/api/reservations", { method: "POST", body: JSON.stringify({ source: "web", storeId: "store", customerName: "確認", customerPhone: "000", startAt }) }));
    expect(response.status).toBe(400); expect(rpc).not.toHaveBeenCalled();
  });
});
