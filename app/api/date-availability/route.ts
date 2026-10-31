export const maxDuration = 60;
import { NextRequest, NextResponse } from "next/server";
import { isBookingDate } from "../../../lib/reservations/date";
import { dateAvailableStarts } from "../../../lib/reservations/date-availability";
import { readBookingRules } from "../../../lib/booking-rules-server";
import { bookingDateBounds, webBookingWindow } from "../../../lib/booking-rules";
import { supabaseServer } from "../../../lib/supabase-server";

export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const date = request.nextUrl.searchParams.get("date") ?? "";
    if (!isBookingDate(date)) return NextResponse.json({ error: "正しい日付を選択してください。" }, { status: 400, headers });
    // Store scope comes only from deployment configuration, never the request.
    const storeId = process.env.NEXT_PUBLIC_DEFAULT_STORE_ID!, db = supabaseServer();
    const rules = await readBookingRules(storeId, db), bounds = bookingDateBounds(rules);
    if (date < bounds.minDate || date > bounds.maxDate) return NextResponse.json({ slots: [] }, { headers });
    const slots = await dateAvailableStarts(storeId, date, db);
    const window = webBookingWindow(rules);
    return NextResponse.json({ slots: slots.filter(s => window.accepts(s.startAt)) }, { headers });
  } catch {
    return NextResponse.json({ error: "空き枠を取得できません。時間をおいて再度お試しください。" }, { status: 503, headers });
  }
}
