import { supabaseServer } from "../supabase-server";
import { refreshCalendarBusy } from "../google-calendar-busy";
import { addMinutes, findAvailableStarts } from "./availability";
import { TIME_STEP_MS } from "./time-grid";

export type DateSlot = { serviceId: string; staffId: string; staffName: string; startAt: string };

/** Read a day's conflicts once for all public menus and staff. Never cache user data. */
export async function dateAvailableStarts(storeId: string, date: string, db = supabaseServer()): Promise<DateSlot[]> {
  const [menus, assignments, hours] = await Promise.all([
    db.from("services").select("id,active,online_bookable,duration_minutes,buffer_before,buffer_after").eq("store_id", storeId),
    db.from("staff_services").select("service_id,staff_id,staff!inner(name,active,store_id)").eq("staff.active", true).eq("staff.store_id", storeId),
    db.from("business_hours").select("start_time,end_time").eq("store_id", storeId).eq("weekday", new Date(`${date}T00:00:00Z`).getUTCDay()),
  ]);
  // PostgREST may cap a response at 1,000 rows. An incomplete conflict set must
  // never turn an occupied time into an available time.
  for (const result of [menus, assignments, hours]) {
    if (result.error || !result.data || result.data.length >= 1000) throw new Error("Availability settings incomplete");
  }
  const services = menus.data!;
  const publicMenus = services.filter(s => s.active && s.online_bookable);
  if (!publicMenus.length || !hours.data!.length) return [];
  const dayStart = new Date(`${date}T00:00:00+09:00`), dayEnd = addMinutes(dayStart, 1440);
  const maxBefore = Math.max(0, ...services.map(s => s.buffer_before));
  const maxAfter = Math.max(0, ...services.map(s => s.buffer_after));
  const windowStart = addMinutes(dayStart, -maxBefore);
  const [bookings, blocks, googleBusy] = await Promise.all([
    db.from("reservations").select("staff_id,start_at,end_at,services(buffer_before,buffer_after)").eq("store_id", storeId).eq("status", "confirmed")
      .lt("start_at", addMinutes(dayEnd, maxBefore).toISOString()).gt("end_at", addMinutes(windowStart, -maxAfter).toISOString()),
    db.from("availability_blocks").select("staff_id,start_at,end_at").eq("store_id", storeId).lt("start_at", dayEnd.toISOString()).gt("end_at", windowStart.toISOString()),
    refreshCalendarBusy(storeId, date, db),
  ]);
  for (const result of [bookings, blocks]) {
    if (result.error || !result.data || result.data.length >= 1000) throw new Error("Availability conflicts incomplete");
  }
  const open = hours.data!.map(h => ({
    start: new Date(Math.ceil(Date.parse(`${date}T${h.start_time}+09:00`) / TIME_STEP_MS) * TIME_STEP_MS),
    end: new Date(`${date}T${h.end_time}+09:00`),
  }));
  const sharedBusy = googleBusy.map(r => ({ start: new Date(r.start), end: new Date(r.end) }));
  const occupiedByStaff = new Map<string, { start: Date; end: Date }[]>();
  const result: DateSlot[] = [];
  for (const menu of publicMenus) for (const link of assignments.data!.filter(a => a.service_id === menu.id)) {
    const staff = Array.isArray(link.staff) ? link.staff[0] : link.staff;
    if (!staff) throw new Error("Staff missing");
    let occupied = occupiedByStaff.get(link.staff_id);
    if (!occupied) {
      occupied = [
        ...sharedBusy,
        ...bookings.data!.filter(b => b.staff_id === link.staff_id).map(b => {
          const buffer = Array.isArray(b.services) ? b.services[0] : b.services;
          if (!buffer) throw new Error("Reservation service missing");
          return { start: addMinutes(new Date(b.start_at), -buffer.buffer_before), end: addMinutes(new Date(b.end_at), buffer.buffer_after) };
        }),
        ...blocks.data!.filter(b => !b.staff_id || b.staff_id === link.staff_id).map(b => ({ start: new Date(b.start_at), end: new Date(b.end_at) })),
      ];
      occupiedByStaff.set(link.staff_id, occupied);
    }
    const starts = new Set(findAvailableStarts({ open, occupied, durationMinutes: menu.duration_minutes, bufferBefore: menu.buffer_before, bufferAfter: menu.buffer_after }).map(s => s.toISOString()));
    for (const startAt of starts) result.push({ serviceId: menu.id, staffId: link.staff_id, staffName: staff.name, startAt });
  }
  return result.sort((a, b) => a.startAt.localeCompare(b.startAt));
}
