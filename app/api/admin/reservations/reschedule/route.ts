import { NextRequest, NextResponse } from "next/server";
import { authorizeStaff } from "../../../../../lib/admin-auth";
import { supabaseServer } from "../../../../../lib/supabase-server";

export async function POST(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const staff = await authorizeStaff(request.headers.get("authorization"));
    if (!staff) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers });
    let body;
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400, headers }); }
    const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
    const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
    if (!body || typeof body.reservationId !== "string" || !uuid.test(body.reservationId) ||
        typeof body.staffId !== "string" || !uuid.test(body.staffId) ||
        typeof body.startAt !== "string" || !timestamp.test(body.startAt) || !Number.isFinite(Date.parse(body.startAt)) || Date.parse(body.startAt) % 1800000 !== 0 ||
        typeof body.expectedUpdatedAt !== "string" || !timestamp.test(body.expectedUpdatedAt) || !Number.isFinite(Date.parse(body.expectedUpdatedAt))) {
      return NextResponse.json({ error: "担当者と30分刻みの空き時間を選択してください。" }, { status: 400, headers });
    }
    const { data, error } = await supabaseServer().rpc("reschedule_reservation_atomic", {
      p_store_id: staff.storeId, p_reservation_id: body.reservationId, p_staff_id: body.staffId,
      p_start_at: body.startAt, p_expected_updated_at: body.expectedUpdatedAt,
    });
    if (error) {
      if (error.code === "PGRST202") return NextResponse.json({ error: "予約変更用のDB設定が未適用です。管理者にお問い合わせください。" }, { status: 503, headers });
      if (error.message.includes("reservation_not_found")) return NextResponse.json({ error: "予約が見つかりません。一覧を更新してください。" }, { status: 404, headers });
      if (error.message.includes("reservation_changed")) return NextResponse.json({ error: "予約が更新またはキャンセルされています。一覧を更新して選び直してください。" }, { status: 409, headers });
      if (error.message.includes("outside_business_hours") || error.message.includes("invalid_staff_service") || error.message.includes("time_slot_unavailable") || error.code === "23P01")
        return NextResponse.json({ error: "選択した枠に変更できません。空き時間を更新して選び直してください。" }, { status: 409, headers });
      throw error;
    }
    return NextResponse.json({ reservation: { id: data.id, staffId: data.staff_id, startAt: data.start_at } }, { headers });
  } catch {
    return NextResponse.json({ error: "変更結果を確認できませんでした。一覧を更新して予約状態を確認してください。" }, { status: 503, headers });
  }
}
