import { supabaseServer } from "../supabase-server";
import { addMinutes, findAvailableStarts } from "./availability";

export function isBookingDate(date: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(`${date}T00:00:00Z`)) &&
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
}

/** Japan-time slots for one authenticated store/staff, including offline services. */
export async function adminAvailableStarts(storeId: string, serviceId: string, staffId: string, date: string, excludeReservationId?: string) {
  const db = supabaseServer();
  const dayStart = new Date(`${date}T00:00:00+09:00`);
  const dayEnd = new Date(dayStart.getTime() + 86400000);
  const [serviceResult, assignment, hoursResult, buffersResult] = await Promise.all([
    db.from("services").select("duration_minutes,buffer_before,buffer_after")
      .eq("store_id", storeId).eq("id", serviceId).eq("active", true).maybeSingle(),
    db.from("staff_services").select("staff_id,staff!inner(store_id,active)")
      .eq("service_id", serviceId).eq("staff_id", staffId).eq("staff.store_id", storeId).eq("staff.active", true).maybeSingle(),
    db.from("business_hours").select("start_time,end_time").eq("store_id", storeId)
      .eq("weekday", new Date(`${date}T00:00:00Z`).getUTCDay()),
    db.from("services").select("buffer_before,buffer_after").eq("store_id", storeId),
  ]);
  if (serviceResult.error || assignment.error || hoursResult.error || buffersResult.error) throw new Error("Availability settings failed");
  const service = serviceResult.data;
  if (!service || !assignment.data) return null;
  // Include reservations on adjacent dates whose preparation/cleanup crosses midnight.
  const maxBefore = Math.max(0, ...(buffersResult.data ?? []).map(s => s.buffer_before));
  const maxAfter = Math.max(0, ...(buffersResult.data ?? []).map(s => s.buffer_after));
  const windowStart = addMinutes(dayStart, -service.buffer_before);
  let conflicts = db.from("reservations").select("start_at,end_at,services(buffer_before,buffer_after)")
      .eq("store_id", storeId).eq("staff_id", staffId).eq("status", "confirmed")
      .lt("start_at", addMinutes(dayEnd, maxBefore).toISOString())
      .gt("end_at", addMinutes(windowStart, -maxAfter).toISOString());
  if (excludeReservationId) conflicts = conflicts.neq("id", excludeReservationId);
  const [reservationsResult, blocksResult] = await Promise.all([
    conflicts,
    db.from("availability_blocks").select("staff_id,start_at,end_at").eq("store_id", storeId)
      .lt("start_at", dayEnd.toISOString()).gt("end_at", windowStart.toISOString()),
  ]);
  if (reservationsResult.error || blocksResult.error) throw new Error("Availability conflicts failed");
  const occupied = [
    ...(reservationsResult.data ?? []).map(row => {
      const buffers = Array.isArray(row.services) ? row.services[0] : row.services;
      if (!buffers) throw new Error("Reservation service missing");
      return { start: addMinutes(new Date(row.start_at), -buffers.buffer_before), end: addMinutes(new Date(row.end_at), buffers.buffer_after) };
    }),
    ...(blocksResult.data ?? []).filter(row => !row.staff_id || row.staff_id === staffId)
      .map(row => ({ start: new Date(row.start_at), end: new Date(row.end_at) })),
  ];
  const open = (hoursResult.data ?? []).map(hours => ({
    start: new Date(Math.ceil(new Date(`${date}T${hours.start_time}+09:00`).getTime() / 1800000) * 1800000),
    end: new Date(`${date}T${hours.end_time}+09:00`),
  }));
  return [...new Set(findAvailableStarts({ open, occupied, durationMinutes: service.duration_minutes,
    bufferBefore: service.buffer_before, bufferAfter: service.buffer_after, intervalMinutes: 30 })
    .map(start => start.toISOString()))].sort();
}
