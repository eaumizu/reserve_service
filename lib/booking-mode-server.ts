import { supabaseServer } from "./supabase-server";
import { isBookingMode, type BookingMode } from "./booking-mode";

export async function readBookingMode(storeId: string, db = supabaseServer()): Promise<{ mode: BookingMode; ready: boolean }> {
  const { data, error } = await db.from("store_booking_preferences").select("booking_mode").eq("store_id", storeId).maybeSingle();
  // Deploying before the additive migration keeps the existing menu-first page.
  // Other failures must not silently change the owner's configured page.
  if (error && ["42P01", "PGRST205"].includes(error.code)) return { mode: "menu", ready: false };
  if (error || (data && !isBookingMode(data.booking_mode))) throw new Error("Booking mode unavailable");
  return { mode: data?.booking_mode ?? "menu", ready: true };
}
