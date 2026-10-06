import { authorizeStaff } from "../../../../lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabase-server";
import type { ReservationInput } from "@/lib/reservations/types";

export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const staff = await authorizeStaff(request.headers.get("authorization"));
    if (!staff) return NextResponse.json({ error: "管理者またはスタッフのログインが必要です。" }, { status: 401, headers });
    const { data, error } = await supabaseServer().from("reservations")
      .select("id,start_at,end_at,status,source,customers(name),services(name),staff(name)")
      .eq("store_id", staff.storeId)
      .order("start_at", { ascending: false }).limit(100);
    if (error) throw error;
    return NextResponse.json({ reservations: data ?? [] }, { headers });
  } catch {
    return NextResponse.json({ error: "予約一覧を取得できませんでした。" }, { status: 503, headers });
  }
}

/** Staff-only endpoint for phone, walk-in, and admin entries. */
export async function POST(request: NextRequest) {
  try {
    const staff = await authorizeStaff(request.headers.get("authorization"));
    if (!staff) return NextResponse.json({ error: "管理者またはスタッフのログインが必要です。" }, { status: 401 });
    let body: ReservationInput;
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400 }); }
    if (!body || typeof body !== "object") return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400 });
    if (!["phone", "walk_in", "admin"].includes(body.source) || body.storeId !== staff.storeId) return NextResponse.json({ error: "この操作は許可されていません。" }, { status: 403 });
    const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
    if (typeof body.serviceId !== "string" || !uuid.test(body.serviceId) ||
        typeof body.staffId !== "string" || !uuid.test(body.staffId) ||
        typeof body.customerName !== "string" || !body.customerName.trim() || body.customerName.length > 100 ||
        typeof body.customerPhone !== "string" || !body.customerPhone.trim() || body.customerPhone.length > 50 ||
        typeof body.startAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(body.startAt) || !Number.isFinite(Date.parse(body.startAt)) ||
        (body.note !== undefined && (typeof body.note !== "string" || body.note.length > 2000))) {
      return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400 });
    }
    const { data, error } = await supabaseServer().rpc("create_reservation_atomic", { p_store_id: staff.storeId, p_service_id: body.serviceId, p_staff_id: body.staffId, p_start_at: body.startAt, p_customer_name: body.customerName.trim(), p_customer_phone: body.customerPhone.trim(), p_source: body.source, p_note: body.note ?? null });
    if (error) return NextResponse.json({ error: error.message.includes("outside_business_hours") ? "営業時間内の枠を指定してください。" : "指定した枠は予約できません。" }, { status: 409 });
    return NextResponse.json({ reservation: data }, { status: 201 });
  } catch { return NextResponse.json({ error: "予約を登録できませんでした。" }, { status: 500 }); }
}
