import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { available, rules, db } = vi.hoisted(() => ({ available: vi.fn(), rules: vi.fn(), db: {} }));
vi.mock("../lib/supabase-server", () => ({ supabaseServer: () => db }));
vi.mock("../lib/booking-rules-server", () => ({ readBookingRules: rules }));
vi.mock("../lib/reservations/date-availability", () => ({ dateAvailability: available }));
import { GET } from "../app/api/date-availability/route";
const request = (day: string) => new NextRequest(`http://localhost/api/date-availability?date=${day}&storeId=untrusted`);
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("NEXT_PUBLIC_DEFAULT_STORE_ID", "trusted");
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2030-01-01T00:00:00Z"));
  rules.mockResolvedValue({ advance_days: 30, cutoff_minutes: 60 });
  available.mockResolvedValue({ times: ["10:00"], slots: [{ serviceId: "menu", staffId: "staff", staffName: "担当", startAt: "2030-01-01T01:00:00.000Z" }] });
});
it("uses the configured store, returns only public slot metadata and never caches", async () => {
  const r = await GET(request("2030-01-01")); expect(r.status).toBe(200);
  expect((await r.json()).slots).toHaveLength(1);
  expect(available).toHaveBeenCalledExactlyOnceWith("trusted", "2030-01-01", db);
  expect(r.headers.get("cache-control")).toBe("no-store");
});
it("filters quarter-hour data from both the public slots and timetable rows", async () => {
  available.mockResolvedValue({ times: ["10:00", "10:15", "10:30", "10:45"], slots: ["00", "15", "30", "45"].map(m => ({ serviceId: "menu", staffId: "staff", staffName: "担当", startAt: `2030-01-01T01:${m}:00.000Z` })) });
  const result = await (await GET(request("2030-01-01"))).json();
  expect(result.times).toEqual(["10:00", "10:30"]);
  expect(result.slots.map((s: { startAt: string }) => s.startAt)).toEqual(["2030-01-01T01:00:00.000Z", "2030-01-01T01:30:00.000Z"]);
});
it("rejects impossible dates and avoids reads outside the reception window", async () => {
  expect((await GET(request("2030-02-30"))).status).toBe(400); expect(rules).not.toHaveBeenCalled();
  expect(await (await GET(request("2029-12-31"))).json()).toEqual({ slots: [], times: [] });
  expect(await (await GET(request("2030-02-01"))).json()).toEqual({ slots: [], times: [] }); expect(available).not.toHaveBeenCalled();
});
it("evaluates the cutoff again after external reads", async () => {
  available.mockImplementationOnce(async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2030-01-01T00:00:01Z"));
    return { times: ["10:00"], slots: [{ serviceId: "menu", staffId: "staff", staffName: "担当", startAt: "2030-01-01T01:00:00.000Z" }] };
  });
  expect(await (await GET(request("2030-01-01"))).json()).toEqual({ slots: [], times: ["10:00"] });
});
it("fails closed without exposing errors or booking data", async () => {
  available.mockRejectedValue(new Error("private backend detail")); const r = await GET(request("2030-01-01"));
  expect(r.status).toBe(503); expect(await r.text()).not.toContain("private"); expect(r.headers.get("cache-control")).toBe("no-store");
});
