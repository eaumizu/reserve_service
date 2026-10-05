import { NextRequest, NextResponse } from "next/server";
import { findAvailableStarts } from "@/lib/reservations/availability";
import { supabaseServer } from "@/lib/supabase-server";
export async function GET(request: NextRequest) {
  try {
    const serviceId = request.nextUrl.searchParams.get("serviceId"); const date = request.nextUrl.searchParams.get("date"); const storeId = process.env.NEXT_PUBLIC_DEFAULT_STORE_ID!;
    if (!serviceId || !/^\d{4}-\d\d-\d\d$/.test(date ?? "")) return NextResponse.json({ error: "serviceId と date が必要です。" }, { status: 400 });
    const db = supabaseServer(); const [{ data: service }, { data: links }, { data: hours }] = await Promise.all([
      db.from("services").select("*").eq("id", serviceId).eq("store_id", storeId).eq("active", true).eq("online_bookable", true).single(),
      db.from("staff_services").select("staff_id,staff!inner(id,name,active,store_id)").eq("service_id", serviceId).eq("staff.active", true).eq("staff.store_id", storeId),
      db.from("business_hours").select("start_time,end_time").eq("store_id", storeId).eq("weekday", new Date(`${date}T12:00:00+09:00`).getDay())
    ]);
    if (!service) return NextResponse.json({ error: "メニューが見つかりません。" }, { status: 404 });
    const dayStart = new Date(`${date}T00:00:00+09:00`); const dayEnd = new Date(dayStart.getTime() + 86400000);
    const staffIds = (links ?? []).map((x: any) => x.staff_id);
    const [{ data: reservations }, { data: blocks }] = await Promise.all([
      db.from("reservations").select("staff_id,start_at,end_at,services(buffer_before,buffer_after)").in("staff_id", staffIds).eq("status", "confirmed").lt("start_at", dayEnd.toISOString()).gt("end_at", dayStart.toISOString()),
      db.from("availability_blocks").select("staff_id,start_at,end_at").eq("store_id", storeId).lt("start_at", dayEnd.toISOString()).gt("end_at", dayStart.toISOString())
    ]);
    const open = (hours ?? []).map((h) => ({ start: new Date(`${date}T${h.start_time}+09:00`), end: new Date(`${date}T${h.end_time}+09:00`) }));
    const slots = (links ?? []).flatMap((link: any) => findAvailableStarts({ open, durationMinutes: service.duration_minutes, bufferBefore: service.buffer_before, bufferAfter: service.buffer_after, occupied: [...(reservations ?? []).filter((r: any) => r.staff_id === link.staff_id).map((r: any) => ({ start: new Date(new Date(r.start_at).getTime() - r.services.buffer_before * 60000), end: new Date(new Date(r.end_at).getTime() + r.services.buffer_after * 60000) })), ...(blocks ?? []).filter((b) => !b.staff_id || b.staff_id === link.staff_id).map((b) => ({ start: new Date(b.start_at), end: new Date(b.end_at) }))] }).map((start) => ({ staffId: link.staff_id, staffName: link.staff.name, startAt: start.toISOString() })));
    return NextResponse.json({ slots });
  } catch { return NextResponse.json({ error: "空き枠を取得できません。" }, { status: 503 }); }
}
