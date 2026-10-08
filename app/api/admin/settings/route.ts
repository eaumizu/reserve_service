import { NextRequest, NextResponse } from "next/server";
import { authorizeStaff } from "../../../../lib/admin-auth";
import { supabaseServer } from "../../../../lib/supabase-server";
import { parseSettingsChange } from "../../../../lib/store-settings";
import { readBookingRules } from "../../../../lib/booking-rules-server";

const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: NextRequest) {
  try {
    const user = await authorizeStaff(request.headers.get("authorization"));
    if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers });
    if (user.role !== "admin") return NextResponse.json({ error: "店舗設定は管理者のみ操作できます。" }, { status: 403, headers });
    const db = supabaseServer();
    const [store, services, staff, links, hours] = await Promise.all([
      db.from("stores").select("id,name,timezone").eq("id", user.storeId).single(),
      db.from("services").select("id,name,duration_minutes,buffer_before,buffer_after,price,active,online_bookable").eq("store_id", user.storeId).order("created_at"),
      db.from("staff").select("id,name,active").eq("store_id", user.storeId).order("created_at"),
      db.from("staff_services").select("staff_id,service_id,staff!inner(store_id),services!inner(store_id)")
        .eq("staff.store_id", user.storeId).eq("services.store_id", user.storeId),
      db.from("business_hours").select("weekday,start_time,end_time").eq("store_id", user.storeId).order("weekday").order("start_time"),
    ]);
    if (store.error || services.error || staff.error || links.error || hours.error) throw new Error("Settings read failed");
    return NextResponse.json({ store: store.data, bookingRules: await readBookingRules(user.storeId), services: services.data, staff: staff.data,
      links: (links.data ?? []).map(link => ({ staff_id: link.staff_id, service_id: link.service_id })),
      hours: (hours.data ?? []).map(hour => ({ ...hour, start_time: hour.start_time.slice(0, 5), end_time: hour.end_time.slice(0, 5) })) }, { headers });
  } catch { return NextResponse.json({ error: "店舗設定を取得できませんでした。" }, { status: 503, headers }); }
}

export async function POST(request: NextRequest) {
  try {
    const user = await authorizeStaff(request.headers.get("authorization"));
    if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers });
    if (user.role !== "admin") return NextResponse.json({ error: "店舗設定は管理者のみ操作できます。" }, { status: 403, headers });
    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400, headers }); }
    const change = parseSettingsChange(body);
    if (!change) return NextResponse.json({ error: "入力内容を確認してください。名前・金額・施術時間・営業時間に不正な値があります。" }, { status: 400, headers });
    const { data, error } = change.kind === "booking_rules" ? await supabaseServer().rpc("save_booking_rules_atomic", {
      p_store_id: user.storeId, p_advance_days: change.data.advance_days, p_cutoff_minutes: change.data.cutoff_minutes,
    }) : await supabaseServer().rpc("save_store_settings_atomic", {
      p_store_id: user.storeId, p_kind: change.kind, p_data: change.data,
    });
    if (error) {
      if (error.code === "PGRST202") return NextResponse.json({ error: "店舗設定用のDB設定が未適用です。管理者にお問い合わせください。" }, { status: 503, headers });
      if (error.message.includes("service_timing_has_reservations")) return NextResponse.json({ error: "予約履歴があるメニューの施術時間・準備時間は変更できません。新しいメニューを追加してください。" }, { status: 409, headers });
      if (error.message.includes("business_hours_have_reservations")) return NextResponse.json({ error: "既存予約が新しい営業時間外になります。対象の予約を先に変更してから保存してください。" }, { status: 409, headers });
      if (error.message.includes("settings_not_found")) return NextResponse.json({ error: "対象が見つかりません。設定を再読み込みしてください。" }, { status: 404, headers });
      if (error.message.includes("invalid_staff_service") || error.message.includes("invalid_settings") || error.message.includes("overlapping_business_hours") || ["22P02", "22003"].includes(error.code))
        return NextResponse.json({ error: "入力内容や対応メニューを確認してください。" }, { status: 400, headers });
      throw error;
    }
    return NextResponse.json({ saved: true, id: data.id }, { headers });
  } catch { return NextResponse.json({ error: "保存結果を確認できませんでした。設定を再読み込みして確認してください。" }, { status: 503, headers }); }
}
