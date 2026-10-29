
export type BookingRules = { advance_days: number; cutoff_minutes: number };
export const DEFAULT_BOOKING_RULES: BookingRules = { advance_days: 30, cutoff_minutes: 60 };
export function validBookingRules(value: unknown): value is BookingRules {
  if (!value || typeof value !== "object") return false;
  const rules = value as BookingRules;
  return Number.isInteger(rules.advance_days) && rules.advance_days >= 0 && rules.advance_days <= 365 &&
    Number.isInteger(rules.cutoff_minutes) && rules.cutoff_minutes >= 0 && rules.cutoff_minutes <= 1440 && rules.cutoff_minutes % 15 === 0;
}
export function bookingDateBounds(rules: BookingRules, now = Date.now()) {
  const japanDay = new Date(now + 9 * 3600000).toISOString().slice(0, 10);
  const lastDay = new Date(Date.parse(`${japanDay}T00:00:00Z`) + rules.advance_days * 86400000).toISOString().slice(0, 10);
  return { minDate: japanDay, maxDate: lastDay };
}
export function acceptsWebBooking(startAt: string, rules: BookingRules, now = Date.now()) {
  return webBookingWindow(rules, now).accepts(startAt);
}
/** One clock and reception window per availability response, not per slot. */
export function webBookingWindow(rules: BookingRules, now = Date.now()) {
  const bounds = bookingDateBounds(rules, now);
  const minStart = Date.parse(`${bounds.minDate}T00:00:00+09:00`);
  const end = Date.parse(`${bounds.maxDate}T00:00:00+09:00`) + 86400000;
  const cutoff = now + rules.cutoff_minutes * 60000;
  return { ...bounds, accepts: (startAt: string) => {
    const start = Date.parse(startAt);
    return Number.isFinite(start) && start > now && start >= cutoff && start >= minStart && start < end;
  } };
}
