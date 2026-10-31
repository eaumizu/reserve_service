export const TIME_STEP_MINUTES = 15;
export const TIME_STEP_MS = TIME_STEP_MINUTES * 60_000;
export const CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):(00|15|30|45)$/;
export const CLOCK_TIMES = Array.from({ length: 24 * 60 / TIME_STEP_MINUTES }, (_, i) => {
  const minutes = i * TIME_STEP_MINUTES;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});
export const DURATION_OPTIONS = Array.from({ length: 1440 / TIME_STEP_MINUTES }, (_, i) => (i + 1) * TIME_STEP_MINUTES);
export function isGridTimestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value)) && Date.parse(value) % TIME_STEP_MS === 0;
}

// Public start times are separate from the 15-minute operational grid used for
// treatment/buffer settings, closures, and staff adjustments of existing bookings.
export const PUBLIC_BOOKING_STEP_MINUTES = 30;
export const PUBLIC_BOOKING_STEP_MS = PUBLIC_BOOKING_STEP_MINUTES * 60_000;
export const PUBLIC_BOOKING_CLOCK_PATTERN = /^([01]\d|2[0-3]):(00|30)$/;
export function isPublicBookingStart(value: unknown): value is string {
  return isGridTimestamp(value) && Date.parse(value) % PUBLIC_BOOKING_STEP_MS === 0;
}
