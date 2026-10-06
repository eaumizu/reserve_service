import { beforeEach, describe, expect, it, vi } from "vitest";
const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("../lib/supabase-server", () => ({ supabaseServer: () => ({ from }) }));
import { adminAvailableStarts, isBookingDate } from "../lib/reservations/admin-availability";

type Row = { start_at: string; end_at: string; services: { buffer_before: number; buffer_after: number } };
let reservations: Row[];
let blocks: { staff_id: string | null; start_at: string; end_at: string }[];
let hours: { start_time: string; end_time: string }[];
let settingsError: boolean;
let conflictsError: boolean;
let assigned: boolean;
const queries: { table: string; fields: string; eq: ReturnType<typeof vi.fn>; lt: ReturnType<typeof vi.fn>; gt: ReturnType<typeof vi.fn> }[] = [];
const store = "verified-store", service = "service", staff = "staff";
const jst = (time: string) => `2030-01-01T${time}:00+09:00`;
beforeEach(() => {
  reservations = []; blocks = []; hours = [{ start_time: "09:00:00", end_time: "11:00:00" }];
  settingsError = false; conflictsError = false; assigned = true; queries.length = 0;
  from.mockReset();
  from.mockImplementation(table => {
    const q = { table, fields: "", select: vi.fn(), eq: vi.fn(), neq: vi.fn(), lt: vi.fn(), gt: vi.fn(), maybeSingle: vi.fn(), then: vi.fn() };
    q.select.mockImplementation(fields => { q.fields = fields; return q; });
    q.eq.mockReturnValue(q); q.neq.mockReturnValue(q); q.lt.mockReturnValue(q); q.gt.mockReturnValue(q);
    function result() {
      const error = (settingsError && table === "business_hours") || (conflictsError && table === "reservations") ? { message: "DB unavailable" } : null;
      const data = table === "services" ? q.fields.includes("duration_minutes") ? { duration_minutes: 30, buffer_before: 0, buffer_after: 10 } : [{ buffer_before: 0, buffer_after: 10 }]
        : table === "staff_services" ? assigned ? { staff_id: staff } : null
        : table === "business_hours" ? hours : table === "reservations" ? reservations : blocks;
      return { data, error };
    }
    q.maybeSingle.mockImplementation(async () => result());
    q.then.mockImplementation(resolve => resolve(result()));
    queries.push(q);
    return q;
  });
});
describe("Japan-time admin availability", () => {
  it.each(["2030-02-30", "2030-13-01", "2030-1-1", "not-a-date"])("rejects invalid calendar date %s", date => {
    expect(isBookingDate(date)).toBe(false);
  });
  it("accepts a valid leap date", () => expect(isBookingDate("2028-02-29")).toBe(true));
  it("returns 30-minute Japan-time starts that fit the treatment and cleanup", async () => {
    expect(await adminAvailableStarts(store, service, staff, "2030-01-01"))
      .toEqual(["2030-01-01T00:00:00.000Z", "2030-01-01T00:30:00.000Z", "2030-01-01T01:00:00.000Z"]);
    const hoursQuery = queries.find(q => q.table === "business_hours")!;
    expect(hoursQuery.eq).toHaveBeenCalledWith("weekday", 2);
    expect(queries.filter(q => q.table === "services").some(q => q.eq.mock.calls.some(call => call[0] === "online_bookable"))).toBe(false);
  });
  it("aligns starts to :00 and :30 even when opening is at 09:15", async () => {
    hours = [{ start_time: "09:15:00", end_time: "11:00:00" }];
    expect(await adminAvailableStarts(store, service, staff, "2030-01-01"))
      .toEqual(["2030-01-01T00:30:00.000Z", "2030-01-01T01:00:00.000Z"]);
  });
  it("excludes existing reservations and their buffers", async () => {
    reservations = [{ start_at: jst("09:00"), end_at: jst("09:30"), services: { buffer_before: 0, buffer_after: 10 } }];
    expect(await adminAvailableStarts(store, service, staff, "2030-01-01"))
      .toEqual(["2030-01-01T01:00:00.000Z"]);
    const query = queries.find(q => q.table === "reservations")!;
    expect(query.eq.mock.calls).toEqual([["store_id", store], ["staff_id", staff], ["status", "confirmed"]]);
    expect(query.gt).toHaveBeenCalledWith("end_at", "2029-12-31T14:50:00.000Z");
  });
  it("honors store-wide blocks but ignores blocks for another staff member", async () => {
    blocks = [{ staff_id: null, start_at: jst("09:00"), end_at: jst("10:00") }, { staff_id: "other", start_at: jst("10:00"), end_at: jst("11:00") }];
    expect(await adminAvailableStarts(store, service, staff, "2030-01-01"))
      .toEqual(["2030-01-01T01:00:00.000Z"]);
  });
  it("returns no slots on a closed day", async () => {
    hours = [];
    expect(await adminAvailableStarts(store, service, staff, "2030-01-01")).toEqual([]);
  });
  it("rejects staff without a matching active assignment", async () => {
    assigned = false;
    expect(await adminAvailableStarts(store, service, staff, "2030-01-01")).toBeNull();
  });
  it("excludes only the verified reservation when finding change slots", async () => {
    await adminAvailableStarts(store, service, staff, "2030-01-01", "current-reservation");
    const query = from.mock.results.map(result => result.value).find(q => q.table === "reservations");
    expect(query.neq).toHaveBeenCalledWith("id", "current-reservation");
    expect(query.eq).toHaveBeenCalledWith("store_id", store);
  });
  it("fails closed when settings or reservations cannot be read", async () => {
    settingsError = true;
    await expect(adminAvailableStarts(store, service, staff, "2030-01-01")).rejects.toThrow();
    settingsError = false; conflictsError = true;
    await expect(adminAvailableStarts(store, service, staff, "2030-01-01")).rejects.toThrow();
  });
});
