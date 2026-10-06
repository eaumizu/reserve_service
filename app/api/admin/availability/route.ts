import { NextRequest, NextResponse } from "next/server";
import { authorizeStaff } from "../../../../lib/admin-auth";
import { adminAvailableStarts, isBookingDate } from "../../../../lib/reservations/admin-availability";
import { supabaseServer } from "../../../../lib/supabase-server";

export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const staff = await authorizeStaff(request.headers.get("authorization"));
    if (!staff) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers });
    const serviceId = request.nextUrl.searchParams.get("serviceId") ?? "";
    const staffId = request.nextUrl.searchParams.get("staffId") ?? "";
    const date = request.nextUrl.searchParams.get("date") ?? "";
    const reservationId = request.nextUrl.searchParams.get("reservationId");
    const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
    if (!uuid.test(serviceId) || !uuid.test(staffId) || !isBookingDate(date) || (reservationId !== null && !uuid.test(reservationId)))
      return NextResponse.json({ error: "メニュー・担当者・日付を選択してください。" }, { status: 400, headers });
    if (reservationId) {
      const { data, error } = await supabaseServer().from("reservations").select("service_id,status")
        .eq("id", reservationId).eq("store_id", staff.storeId).maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: "予約が見つかりません。" }, { status: 404, headers });
      if (data.status !== "confirmed" || data.service_id !== serviceId)
        return NextResponse.json({ error: "予約の状態が変わっています。一覧を更新してください。" }, { status: 409, headers });
    }
    const slots = reservationId
      ? await adminAvailableStarts(staff.storeId, serviceId, staffId, date, reservationId)
      : await adminAvailableStarts(staff.storeId, serviceId, staffId, date);
    if (!slots) return NextResponse.json({ error: "選択したメニューまたは担当者が見つかりません。" }, { status: 404, headers });
    return NextResponse.json({ slots }, { headers });
  } catch {
    return NextResponse.json({ error: "空き時間を取得できませんでした。" }, { status: 503, headers });
  }
}
