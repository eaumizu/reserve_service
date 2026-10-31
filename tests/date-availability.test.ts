import { beforeEach, describe, expect, it, vi } from "vitest";
const { from, googleBusy } = vi.hoisted(() => ({ from: vi.fn(), googleBusy: vi.fn() }));
vi.mock("../lib/supabase-server", () => ({ supabaseServer: () => ({ from }) }));
vi.mock("../lib/google-calendar-busy", () => ({ refreshCalendarBusy: googleBusy }));
import { dateAvailableStarts } from "../lib/reservations/date-availability";
import { adminAvailableStarts } from "../lib/reservations/admin-availability";

const store = "trusted-store", day = "2030-01-01";
const time = (clock: string) => `${day}T${clock}:00+09:00`;
const menu = (id: string, duration: number, active = true, online = true) => ({ id, store_id: store, duration_minutes: duration, buffer_before: 15, buffer_after: 10, active, online_bookable: online });
const link = (service: string, staff: string, active = true) => ({ service_id: service, staff_id: staff, staff: { name: staff, store_id: store, active } });
type Row = Record<string, any>;
let tables: Record<string, Row[]>, errorTable: string;
let queries: { table: string; eq: ReturnType<typeof vi.fn>; lt: ReturnType<typeof vi.fn>; gt: ReturnType<typeof vi.fn> }[];
beforeEach(() => {
  vi.clearAllMocks(); googleBusy.mockResolvedValue([]); queries = []; errorTable = "";
  tables = {
    services: [menu("short", 30), menu("long", 90), menu("hidden", 15, true, false), menu("retired", 15, false)],
    staff_services: [link("short", "a"), link("short", "b"), link("long", "a"), link("hidden", "a"), link("retired", "a"), link("long", "inactive", false), { ...link("long", "foreign"), staff: { name: "foreign", active: true, store_id: "other-store" } }],
    business_hours: [{ store_id: store, weekday: 2, start_time: "09:10:00", end_time: "12:00:00" }],
    reservations: [], availability_blocks: [],
  };
  from.mockImplementation(table => {
    const filters: ((r: Row) => boolean)[] = [];
    const field = (row: Row, key: string): any => key.split(".").reduce((v, k) => v?.[k], row);
    const q = { table, select: vi.fn(), eq: vi.fn(), lt: vi.fn(), gt: vi.fn(), neq: vi.fn(), maybeSingle: vi.fn(), then: vi.fn() };
    q.select.mockReturnValue(q);
    q.eq.mockImplementation((key, value) => { filters.push(r => field(r, key) === value); return q; });
    q.neq.mockImplementation((key, value) => { filters.push(r => field(r, key) !== value); return q; });
    q.lt.mockImplementation((key, value) => { filters.push(r => Date.parse(field(r, key)) < Date.parse(value)); return q; });
    q.gt.mockImplementation((key, value) => { filters.push(r => Date.parse(field(r, key)) > Date.parse(value)); return q; });
    const result = () => ({ data: (tables[table] ?? []).filter(row => filters.every(f => f(row))), error: table === errorTable ? { message: "unavailable" } : null });
    q.then.mockImplementation(resolve => resolve(result()));
    q.maybeSingle.mockImplementation(async () => { const r = result(); return { ...r, data: r.data[0] ?? null }; });
    queries.push(q); return q;
  });
});
describe("date-first availability", () => {
  it("matches existing buffer-aware availability for each menu/staff with five shared DB reads", async () => {
    tables.reservations = [{ store_id: store, staff_id: "a", status: "confirmed", start_at: time("10:30"), end_at: time("11:00"), services: { buffer_before: 15, buffer_after: 10 } }];
    tables.availability_blocks = [{ store_id: store, staff_id: "b", start_at: time("09:00"), end_at: time("10:00") }];
    googleBusy.mockResolvedValue([{ start: time("11:30"), end: time("12:00") }]);
    const slots = await dateAvailableStarts(store, day);
    expect(queries).toHaveLength(5);
    expect(googleBusy).toHaveBeenCalledExactlyOnceWith(store, day, expect.objectContaining({ from }));
    expect(queries.every(q => q.eq.mock.calls.some(c => (c[0] === "store_id" || c[0] === "staff.store_id") && c[1] === store))).toBe(true);
    for (const [serviceId, staffId] of [["short", "a"], ["short", "b"], ["long", "a"]]) {
      expect(slots.filter(s => s.serviceId === serviceId && s.staffId === staffId).map(s => s.startAt))
        .toEqual(await adminAvailableStarts(store, serviceId, staffId, day));
    }
    expect(slots.some(s => s.serviceId === "hidden" || s.serviceId === "retired" || s.staffId === "inactive" || s.staffId === "foreign")).toBe(false);
    expect(slots.some(s => s.serviceId === "short" && s.staffId === "b" && s.startAt === new Date(time("10:15")).toISOString())).toBe(true);
  });
  it("includes adjacent-day buffers, staff closures and store-wide closures", async () => {
    tables.business_hours = [{ store_id: store, weekday: 2, start_time: "00:00:00", end_time: "02:00:00" }];
    tables.reservations = [{ store_id: store, staff_id: "a", status: "confirmed", start_at: "2029-12-31T23:00:00+09:00", end_at: "2029-12-31T23:55:00+09:00", services: { buffer_before: 0, buffer_after: 30 } }];
    tables.availability_blocks = [{ store_id: store, staff_id: null, start_at: time("01:00"), end_at: time("01:30") }];
    const slots = await dateAvailableStarts(store, day);
    for (const [serviceId, staffId] of [["short", "a"], ["short", "b"], ["long", "a"]]) {
      expect(slots.filter(s => s.serviceId === serviceId && s.staffId === staffId).map(s => s.startAt)).toEqual(await adminAvailableStarts(store, serviceId, staffId, day));
    }
    expect(slots.filter(s => s.staffId === "a").every(s => s.startAt >= new Date(time("00:45")).toISOString())).toBe(true);
  });
  it("offers a short menu but not a long menu close to closing time", async () => {
    const slots = await dateAvailableStarts(store, day), late = new Date(time("11:15")).toISOString();
    expect(slots.some(s => s.startAt === late && s.serviceId === "short")).toBe(true);
    expect(slots.some(s => s.startAt === late && s.serviceId === "long")).toBe(false);
  });
  it("does not contact Google or read reservations on a closed day", async () => {
    tables.business_hours = [];
    expect(await dateAvailableStarts(store, day)).toEqual([]);
    expect(googleBusy).not.toHaveBeenCalled(); expect(queries).toHaveLength(3);
  });
  it.each(["services", "staff_services", "business_hours", "reservations", "availability_blocks"])("fails closed on %s read errors", async table => {
    errorTable = table; await expect(dateAvailableStarts(store, day)).rejects.toThrow();
  });
  it("fails closed on a capped conflict response or failed Google refresh", async () => {
    tables.availability_blocks = Array.from({ length: 1000 }, () => ({ store_id: store, staff_id: null, start_at: time("09:00"), end_at: time("10:00") }));
    await expect(dateAvailableStarts(store, day)).rejects.toThrow("incomplete");
    tables.availability_blocks = []; googleBusy.mockRejectedValue(new Error("google unavailable"));
    await expect(dateAvailableStarts(store, day)).rejects.toThrow("google unavailable");
  });
});
