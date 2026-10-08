import { supabaseServer } from "./supabase-server";
import { validBookingRules, DEFAULT_BOOKING_RULES, type BookingRules } from "./booking-rules";
export async function readBookingRules(storeId: string): Promise<BookingRules> {
  const { data, error } = await supabaseServer().from("stores").select("advance_days,cutoff_minutes").eq("id", storeId).maybeSingle();
  // During rollout, use the same defaults until migration 0008 adds the columns.
  if (error && ["42703", "PGRST204"].includes(error.code)) return { ...DEFAULT_BOOKING_RULES };
  if (error || !validBookingRules(data)) throw new Error("Booking rules unavailable");
  return { advance_days: data.advance_days, cutoff_minutes: data.cutoff_minutes };
}
