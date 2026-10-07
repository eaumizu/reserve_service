import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { from, adminAvailableStarts } = vi.hoisted(() => ({ from: vi.fn(), adminAvailableStarts: vi.fn() }));
vi.mock("../lib/supabase-server", () => ({ supabaseServer: () => ({ from }) }));
vi.mock("../lib/reservations/admin-availability", () => ({ adminAvailableStarts }));
import { GET } from "../app/api/availability/route";
let queryError: boolean;
let availableService: boolean;
const queries: { table: string; eq: ReturnType<typeof vi.fn> }[] = [];
const request = (date = "2030-01-01") => new NextRequest(`http://localhost/api/availability?date=${date}&serviceId=service`);
beforeEach(() => {
  vi.resetAllMocks(); queries.length = 0; queryError = false; availableService = true;
  vi.stubEnv("NEXT_PUBLIC_DEFAULT_STORE_ID", "trusted-store");
  adminAvailableStarts.mockResolvedValue(["2030-01-01T03:00:00.000Z"]);
  from.mockImplementation(table => {
    const q = { table, select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), then: vi.fn() };
    q.select.mockReturnValue(q); q.eq.mockReturnValue(q);
    const result = () => ({ error: queryError ? { message: "DB failed" } : null,
      data: table === "services" ? availableService ? { id: "service" } : null : [{ staff_id: "staff", staff: { name: "担当" } }] });
    q.maybeSingle.mockImplementation(async () => result()); q.then.mockImplementation(resolve => resolve(result()));
    queries.push(q); return q;
  });
});
describe("public availability respects managed blocks", () => {
  it("uses shared calculation only for public menus and store staff", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ slots: [{ staffId: "staff", staffName: "担当", startAt: "2030-01-01T03:00:00.000Z" }] });
    expect(adminAvailableStarts).toHaveBeenCalledExactlyOnceWith("trusted-store", "service", "staff", "2030-01-01");
    expect(queries[0].eq).toHaveBeenCalledWith("store_id", "trusted-store");
    expect(queries[0].eq).toHaveBeenCalledWith("online_bookable", true);
    expect(queries[0].eq).toHaveBeenCalledWith("active", true);
    expect(queries[1].eq).toHaveBeenCalledWith("staff.store_id", "trusted-store");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("rejects impossible dates before querying", async () => {
    expect((await GET(request("2030-02-30"))).status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });
  it("does not expose slots when settings or conflict data cannot be read", async () => {
    queryError = true;
    expect((await GET(request())).status).toBe(503);
    expect(adminAvailableStarts).not.toHaveBeenCalled();
    queryError = false; adminAvailableStarts.mockRejectedValue(new Error("Blocks unavailable"));
    expect((await GET(request())).status).toBe(503);
  });
  it("does not calculate slots for a hidden or retired menu", async () => {
    availableService = false;
    expect((await GET(request())).status).toBe(404);
    expect(adminAvailableStarts).not.toHaveBeenCalled();
  });
});
