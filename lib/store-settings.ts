import { CLOCK_TIME_PATTERN } from "./reservations/time-grid";
import { validBookingRules, type BookingRules } from "./booking-rules";
export type SettingsService = {
  id: string; name: string; duration_minutes: number; buffer_before: number;
  buffer_after: number; price: number; active: boolean; online_bookable: boolean;
};
export type SettingsStaff = { id: string; name: string; active: boolean };
export type SettingsHour = { weekday: number; start_time: string; end_time: string };
export type StoreSettings = {
  store: { id: string; name: string; timezone: string };
  bookingRules?: BookingRules;
  services: SettingsService[]; staff: SettingsStaff[];
  links: { staff_id: string; service_id: string }[]; hours: SettingsHour[];
};
type ServiceEdit = Omit<SettingsService, "id"> & { id?: string };
type StaffEdit = Omit<SettingsStaff, "id"> & { id?: string; serviceIds: string[] };
export type SettingsChange =
  | { kind: "store"; data: { name: string } }
  | { kind: "booking_rules"; data: BookingRules }
  | { kind: "service"; data: ServiceEdit }
  | { kind: "staff"; data: StaffEdit }
  | { kind: "hours"; data: { hours: SettingsHour[] } };

const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const time = CLOCK_TIME_PATTERN;
const validName = (value: unknown): value is string => typeof value === "string" && !!value.trim() && value.length <= 100;
const integer = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Return a whitelisted payload; never accept store IDs, timezone or arbitrary columns. */
export function parseSettingsChange(value: unknown): SettingsChange | null {
  if (!object(value) || !object(value.data)) return null;
  const data = value.data;
  if (value.kind === "booking_rules") return validBookingRules(data) ? { kind: "booking_rules", data: { advance_days: data.advance_days, cutoff_minutes: data.cutoff_minutes } } : null;
  if (value.kind === "store") return validName(data.name) ? { kind: "store", data: { name: data.name.trim() } } : null;
  if (value.kind === "service") {
    if (!validName(data.name) || (data.id !== undefined && (typeof data.id !== "string" || !uuid.test(data.id))) ||
        !integer(data.duration_minutes, 1, 1440) || !integer(data.buffer_before, 0, 1440) || !integer(data.buffer_after, 0, 1440) ||
        !integer(data.price, 0, 10000000) || typeof data.active !== "boolean" || typeof data.online_bookable !== "boolean") return null;
    // Existing off-grid values may be retained; the DB checks them against the saved row.
    if (!data.id && [data.duration_minutes, data.buffer_before, data.buffer_after].some(value => value % 15 !== 0)) return null;
    return { kind: "service", data: { ...(data.id ? { id: data.id as string } : {}), name: data.name.trim(),
      duration_minutes: data.duration_minutes, buffer_before: data.buffer_before, buffer_after: data.buffer_after,
      price: data.price, active: data.active, online_bookable: data.online_bookable } };
  }
  if (value.kind === "staff") {
    if (!validName(data.name) || (data.id !== undefined && (typeof data.id !== "string" || !uuid.test(data.id))) ||
        typeof data.active !== "boolean" || !Array.isArray(data.serviceIds) || data.serviceIds.length > 1000 ||
        !data.serviceIds.every(id => typeof id === "string" && uuid.test(id))) return null;
    return { kind: "staff", data: { ...(data.id ? { id: data.id as string } : {}), name: data.name.trim(), active: data.active, serviceIds: [...new Set(data.serviceIds as string[])] } };
  }
  if (value.kind === "hours") {
    if (!Array.isArray(data.hours) || data.hours.length > 28) return null;
    const hours: SettingsHour[] = [];
    for (const row of data.hours) {
      if (!object(row) || !integer(row.weekday, 0, 6) || typeof row.start_time !== "string" || !time.test(row.start_time) ||
          typeof row.end_time !== "string" || !time.test(row.end_time) || row.start_time >= row.end_time) return null;
      const hour = { weekday: row.weekday, start_time: row.start_time, end_time: row.end_time };
      if (hours.some(h => h.weekday === hour.weekday && h.start_time < hour.end_time && hour.start_time < h.end_time)) return null;
      hours.push(hour);
    }
    return { kind: "hours", data: { hours: hours.sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time)) } };
  }
  return null;
}
