export type BookingMode = "menu" | "date";
export function isBookingMode(value: unknown): value is BookingMode {
  return value === "menu" || value === "date";
}
