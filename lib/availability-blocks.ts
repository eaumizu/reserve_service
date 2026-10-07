import { CLOCK_TIME_PATTERN } from "./reservations/time-grid";
import { isBookingDate } from "./reservations/date";

export type AvailabilityBlock = { id: string; staff_id: string | null; start_at: string; end_at: string; reason: string | null };
export type BlockStaff = { id: string; name: string; active: boolean };
export const isBlockId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const time = CLOCK_TIME_PATTERN;

/** Accept Japan-time calendar fields, never caller-supplied store IDs or UTC offsets. */
export function parseAvailabilityBlock(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (data.staffId !== null && !isBlockId(data.staffId)) return null;
  if (typeof data.startDate !== "string" || !isBookingDate(data.startDate) ||
      typeof data.endDate !== "string" || !isBookingDate(data.endDate) ||
      typeof data.startTime !== "string" || !time.test(data.startTime) ||
      typeof data.endTime !== "string" || !time.test(data.endTime) ||
      typeof data.reason !== "string" || data.reason.length > 200) return null;
  const startAt = new Date(`${data.startDate}T${data.startTime}:00+09:00`);
  const endAt = new Date(`${data.endDate}T${data.endTime}:00+09:00`);
  if (endAt <= startAt || endAt.getTime() - startAt.getTime() > 366 * 86400000) return null;
  return { staffId: data.staffId as string | null, startAt: startAt.toISOString(), endAt: endAt.toISOString(), reason: data.reason.trim() || null };
}
