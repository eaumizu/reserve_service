import { NextRequest, NextResponse } from "next/server";
import { authorizeStaff } from "../../../../lib/admin-auth";
import { supabaseServer } from "../../../../lib/supabase-server";
import { isBookingDate } from "../../../../lib/reservations/date";
import { isBlockId, parseAvailabilityBlock } from "../../../../lib/availability-blocks";

const headers = { "Cache-Control": "private, no-store" };
const response = (error: string, status: number) => NextResponse.json({ error }, { status, headers });

export async function GET(request: NextRequest) {
  try {
    const user = await authorizeStaff(request.headers.get("authorization"));
    if (!user) return response("ログインが必要です。", 401);
    if (user.role !== "admin") return response("受付停止は管理者のみ操作できます。", 403);
    const date = request.nextUrl.searchParams.get("date") ?? "";
    if (!isBookingDate(date)) return response("表示日を選択してください。", 400);
    const start = new Date(`${date}T00:00:00+09:00`);
    const end = new Date(start.getTime() + 86400000);
    const db = supabaseServer();
    const [blocks, staff] = await Promise.all([
      db.from("availability_blocks").select("id,staff_id,start_at,end_at,reason").eq("store_id", user.storeId)
        .lt("start_at", end.toISOString()).gt("end_at", start.toISOString()).order("start_at").order("id").limit(201),
      db.from("staff").select("id,name,active").eq("store_id", user.storeId).order("created_at"),
    ]);
    if (blocks.error || staff.error) throw new Error("Blocks read failed");
    return NextResponse.json({ blocks: (blocks.data ?? []).slice(0, 200), staff: staff.data ?? [], truncated: (blocks.data ?? []).length > 200 }, { headers });
  } catch { return response("受付停止を取得できませんでした。再読み込みしてください。", 503); }
}

function rpcError(error: { code: string; message: string }) {
  if (error.code === "PGRST202") return response("受付停止用のDB設定が未適用です。管理者にお問い合わせください。", 503);
  if (error.message.includes("block_has_reservations")) return response("既存予約の施術・準備時間と重なります。対象の予約を先に変更してから登録してください。", 409);
  if (error.message.includes("block_not_found")) return response("対象は既に解除されたか、見つかりません。一覧を再読み込みしてください。", 404);
  if (error.message.includes("invalid_block") || error.message.includes("invalid_staff") || ["22P02", "22003"].includes(error.code))
    return response("担当者と日時を確認してください。終了は開始より後の、未来の日時を選択してください。", 400);
  return response("操作結果を確認できませんでした。一覧を再読み込みして確認してください。", 503);
}

async function mutate(request: NextRequest, action: "create" | "delete") {
  try {
    const user = await authorizeStaff(request.headers.get("authorization"));
    if (!user) return response("ログインが必要です。", 401);
    if (user.role !== "admin") return response("受付停止は管理者のみ操作できます。", 403);
    let body;
    try { body = await request.json(); } catch { return response("入力内容を確認してください。", 400); }
    const data = action === "create" ? parseAvailabilityBlock(body) : null;
    if (action === "create" && !data || action === "delete" && !isBlockId(body?.blockId)) return response("日時・担当者・入力内容を確認してください。時間は15分刻みで選択してください。", 400);
    const { data: saved, error } = await supabaseServer().rpc("manage_availability_block_atomic", {
      p_store_id: user.storeId, p_action: action, p_block_id: action === "delete" ? body.blockId : null,
      p_staff_id: data?.staffId ?? null, p_start_at: data?.startAt ?? null,
      p_end_at: data?.endAt ?? null, p_reason: data?.reason ?? null,
    });
    if (error) return rpcError(error);
    return NextResponse.json({ saved: true, id: saved.id }, { status: action === "create" ? 201 : 200, headers });
  } catch { return response("操作結果を確認できませんでした。一覧を再読み込みして確認してください。", 503); }
}
export const POST = (request: NextRequest) => mutate(request, "create");
export const DELETE = (request: NextRequest) => mutate(request, "delete");
