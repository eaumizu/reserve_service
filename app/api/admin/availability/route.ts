import { NextRequest, NextResponse } from "next/server";
import { authorizeStaff } from "../../../../lib/admin-auth";
import { adminAvailableStarts, isBookingDate } from "../../../../lib/reservations/admin-availability";

export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const staff = await authorizeStaff(request.headers.get("authorization"));
    if (!staff) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers });
    const serviceId = request.nextUrl.searchParams.get("serviceId") ?? "";
    const staffId = request.nextUrl.searchParams.get("staffId") ?? "";
    const date = request.nextUrl.searchParams.get("date") ?? "";
    const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
    if (!uuid.test(serviceId) || !uuid.test(staffId) || !isBookingDate(date))
      return NextResponse.json({ error: "メニュー・担当者・日付を選択してください。" }, { status: 400, headers });
    const slots = await adminAvailableStarts(staff.storeId, serviceId, staffId, date);
    if (!slots) return NextResponse.json({ error: "選択したメニューまたは担当者が見つかりません。" }, { status: 404, headers });
    return NextResponse.json({ slots }, { headers });
  } catch {
    return NextResponse.json({ error: "空き時間を取得できませんでした。" }, { status: 503, headers });
  }
}
