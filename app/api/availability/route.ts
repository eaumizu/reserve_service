import { NextRequest, NextResponse } from "next/server";
import { adminAvailableStarts } from "../../../lib/reservations/admin-availability";
import { isBookingDate } from "../../../lib/reservations/date";
import { supabaseServer } from "../../../lib/supabase-server";
import { readBookingRules } from "../../../lib/booking-rules-server";
import { acceptsWebBooking, bookingDateBounds } from "../../../lib/booking-rules";

export async function GET(request: NextRequest) {
  try {
    const serviceId = request.nextUrl.searchParams.get("serviceId");
    const date = request.nextUrl.searchParams.get("date") ?? "";
    const storeId = process.env.NEXT_PUBLIC_DEFAULT_STORE_ID!;
    if (!serviceId || !isBookingDate(date)) return NextResponse.json({ error: "メニューと正しい日付を選択してください。" }, { status: 400 });
    const rules = await readBookingRules(storeId);
    const bounds = bookingDateBounds(rules);
    if (date < bounds.minDate || date > bounds.maxDate) return NextResponse.json({ slots: [] }, { headers: { "Cache-Control": "no-store" } });
    const db = supabaseServer();
    const [service, links] = await Promise.all([
      db.from("services").select("id").eq("id", serviceId).eq("store_id", storeId).eq("active", true).eq("online_bookable", true).maybeSingle(),
      db.from("staff_services").select("staff_id,staff!inner(name,active,store_id)").eq("service_id", serviceId).eq("staff.active", true).eq("staff.store_id", storeId),
    ]);
    if (service.error || links.error) throw new Error("Availability read failed");
    if (!service.data) return NextResponse.json({ error: "メニューが見つかりません。" }, { status: 404 });
    // Share buffer-aware, quarter-hour calculation with manual bookings and moves.
    const slots = (await Promise.all((links.data ?? []).map(async link => {
      const staff = Array.isArray(link.staff) ? link.staff[0] : link.staff;
      if (!staff) throw new Error("Staff missing");
      const starts = await adminAvailableStarts(storeId, serviceId, link.staff_id, date);
      return (starts ?? []).filter(startAt => acceptsWebBooking(startAt, rules)).map(startAt => ({ staffId: link.staff_id, staffName: staff.name, startAt }));
    }))).flat();
    return NextResponse.json({ slots }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "空き枠を取得できません。" }, { status: 503 }); }
}
