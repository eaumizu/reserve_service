import { NextRequest, NextResponse } from "next/server";
import { authorizeStaff } from "../../../../../../lib/admin-auth";
import { supabaseServer } from "../../../../../../lib/supabase-server";
const headers = { "Cache-Control": "private, no-store" };
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
type Context = { params: Promise<{ id: string }> };
const unavailable = () => NextResponse.json({ error: "スタッフ用メモを利用できません。追加SQL 0009の適用状況を確認してください。" }, { status: 503, headers });
export async function GET(request: NextRequest, context: Context) {
  try {
    const user = await authorizeStaff(request.headers.get("authorization"));
    if (!user) return NextResponse.json({ error: "スタッフのログインが必要です。" }, { status: 401, headers });
    const { id } = await context.params;
    if (!uuid.test(id)) return NextResponse.json({ error: "対象の予約を確認してください。" }, { status: 400, headers });
    const db = supabaseServer();
    const reservation = await db.from("reservations").select("id").eq("id", id).eq("store_id", user.storeId).maybeSingle();
    if (reservation.error) throw reservation.error;
    if (!reservation.data) return NextResponse.json({ error: "予約が見つかりません。" }, { status: 404, headers });
    const { data, error } = await db.from("reservation_staff_notes").select("note,version,updated_at").eq("reservation_id", id).eq("store_id", user.storeId).maybeSingle();
    if (error) { if (["42P01", "PGRST205"].includes(error.code)) return unavailable(); throw error; }
    return NextResponse.json({ note: data?.note ?? "", version: data?.version ?? null, updatedAt: data?.updated_at ?? null }, { headers });
  } catch { return NextResponse.json({ error: "メモを取得できませんでした。詳細を開き直してください。" }, { status: 503, headers }); }
}
export async function POST(request: NextRequest, context: Context) {
  try {
    const user = await authorizeStaff(request.headers.get("authorization"));
    if (!user) return NextResponse.json({ error: "スタッフのログインが必要です。" }, { status: 401, headers });
    const { id } = await context.params;
    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400, headers }); }
    if (!uuid.test(id) || !body || typeof body.note !== "string" || [...body.note].length > 2000 ||
      !(body.expectedVersion === null || typeof body.expectedVersion === "string" && uuid.test(body.expectedVersion)))
      return NextResponse.json({ error: "メモは2000文字以内で入力し、詳細画面から保存してください。" }, { status: 400, headers });
    const { data, error } = await supabaseServer().rpc("save_reservation_staff_note_atomic", {
      p_store_id: user.storeId, p_reservation_id: id, p_note: body.note, p_expected_version: body.expectedVersion, p_user_id: user.userId,
    });
    if (error) {
      if (["PGRST202", "42P01"].includes(error.code)) return unavailable();
      if (error.message.includes("staff_note_changed")) return NextResponse.json({ error: "別の操作でメモが更新されています。入力内容を控えてから、現在のメモを再読み込みしてください。" }, { status: 409, headers });
      if (error.message.includes("reservation_not_found")) return NextResponse.json({ error: "予約が見つかりません。" }, { status: 404, headers });
      if (error.message.includes("invalid_staff_note")) return NextResponse.json({ error: "メモの内容を確認してください。" }, { status: 400, headers });
      throw error;
    }
    return NextResponse.json(data, { headers });
  } catch { return NextResponse.json({ error: "保存結果を確認できませんでした。入力内容を控えてからメモを再読み込みしてください。" }, { status: 503, headers }); }
}
