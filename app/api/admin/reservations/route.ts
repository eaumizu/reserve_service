import { TIME_STEP_MS } from "../../../../lib/reservations/time-grid";
import { authorizeStaff } from "../../../../lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabase-server";
import type { ReservationInput } from "@/lib/reservations/types";
import { literalSearchPattern, parseReservationListFilters, RESERVATION_PAGE_SIZE } from "../../../../lib/reservations/list-filters";

export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const staff = await authorizeStaff(request.headers.get("authorization"));
    if (!staff) return NextResponse.json({ error: "管理者またはスタッフのログインが必要です。" }, { status: 401, headers });
    const filters = parseReservationListFilters(request.nextUrl.searchParams);
    if (!filters) return NextResponse.json({ error: "日付・スタッフ・表示ページを確認してください。" }, { status: 400, headers });
    const db = supabaseServer();
    let query = db.from("reservations")
      .select(`id,service_id,staff_id,start_at,end_at,updated_at,status,source,note,customers${filters.search ? "!inner" : ""}(name,phone),services(name,buffer_after),staff(name)`)
      .eq("store_id", staff.storeId);
    if (filters.start && filters.end) query = query.gte("start_at", filters.start).lt("start_at", filters.end);
    if (filters.staffId) query = query.eq("staff_id", filters.staffId);
    const now = new Date().toISOString();
    if (filters.scope === "upcoming") query = query.eq("status", "confirmed").gt("end_at", now);
    if (filters.scope === "unrecorded") query = query.eq("status", "confirmed").lte("end_at", now);
    if (filters.scope === "history") query = query.in("status", ["cancelled", "completed", "no_show"]);
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.search) query = query.ilike(`customers.${filters.searchBy}`, literalSearchPattern(filters.search));
    const offset = filters.page * RESERVATION_PAGE_SIZE;
    const [reservations, roster] = await Promise.all([
      query.order("start_at", { ascending: filters.scope !== "history" }).order("id", { ascending: true }).range(offset, offset + RESERVATION_PAGE_SIZE),
      db.from("staff").select("id,name,active").eq("store_id", staff.storeId).order("name").order("id"),
    ]);
    if (reservations.error || roster.error) throw new Error("Reservation list read failed");
    return NextResponse.json({ reservations: (reservations.data ?? []).slice(0, RESERVATION_PAGE_SIZE),
      staff: roster.data ?? [], hasMore: (reservations.data ?? []).length > RESERVATION_PAGE_SIZE,
      canManageSettings: staff.role === "admin" }, { headers });
  } catch {
    return NextResponse.json({ error: "予約一覧を取得できませんでした。" }, { status: 503, headers });
  }
}

/** Update only a confirmed reservation in the verified staff member's store. */
export async function PATCH(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const staff = await authorizeStaff(request.headers.get("authorization"));
    if (!staff) return NextResponse.json({ error: "管理者またはスタッフのログインが必要です。" }, { status: 401, headers });
    let body;
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400, headers }); }
    if (!body || typeof body.reservationId !== "string" ||
        !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.reservationId) ||
        !["cancelled", "completed", "no_show"].includes(body.status)) {
      return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400, headers });
    }
    const hasVersion = body.expectedUpdatedAt !== undefined;
    if ((body.status !== "cancelled" || hasVersion) &&
      (typeof body.expectedUpdatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(body.expectedUpdatedAt) || !Number.isFinite(Date.parse(body.expectedUpdatedAt))))
      return NextResponse.json({ error: "予約一覧を更新して、対象を選び直してください。" }, { status: 400, headers });
    const db = supabaseServer();
    let cleanupMinutes = 0;
    if (body.status === "completed") {
      // Preserve the reserved cleanup time before releasing a completed booking.
      const details = await db.from("reservations").select("services(buffer_after)")
        .eq("id", body.reservationId).eq("store_id", staff.storeId).eq("updated_at", body.expectedUpdatedAt).maybeSingle();
      if (details.error) throw details.error;
      if (!details.data) return NextResponse.json({ error: "予約が更新されています。一覧を更新してください。" }, { status: 409, headers });
      const service = Array.isArray(details.data.services) ? details.data.services[0] : details.data.services;
      if (!service || !Number.isInteger(service.buffer_after) || service.buffer_after < 0) throw new Error("Reservation service missing");
      cleanupMinutes = service.buffer_after;
    }
    const now = new Date();
    // All filters are part of one atomic UPDATE: concurrent status changes cannot be overwritten.
    let query = db.from("reservations").update({ status: body.status, updated_at: now.toISOString() })
      .eq("id", body.reservationId).eq("store_id", staff.storeId).eq("status", "confirmed");
    if (hasVersion) query = query.eq("updated_at", body.expectedUpdatedAt);
    if (body.status === "completed") query = query.lte("end_at", new Date(now.getTime() - cleanupMinutes * 60000).toISOString());
    if (body.status === "no_show") query = query.lte("start_at", now.toISOString());
    const { data, error } = await query.select("id,status,updated_at").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "予約が更新されたか、操作できる時刻になっていません。施術完了は片付け時間終了後、無断キャンセルは開始時刻以降に記録できます。一覧を更新してください。" }, { status: 409, headers });
    return NextResponse.json({ reservation: data }, { headers });
  } catch {
    return NextResponse.json({ error: "予約状態の更新結果を確認できませんでした。一覧を更新して確認してください。" }, { status: 503, headers });
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
    if (Date.parse(body.startAt) % TIME_STEP_MS !== 0) {
      return NextResponse.json({ error: "開始時間は15分刻みの空き枠から選択してください。" }, { status: 400 });
    }
    const { data, error } = await supabaseServer().rpc("create_reservation_atomic", { p_store_id: staff.storeId, p_service_id: body.serviceId, p_staff_id: body.staffId, p_start_at: body.startAt, p_customer_name: body.customerName.trim(), p_customer_phone: body.customerPhone.trim(), p_source: body.source, p_note: body.note ?? null });
    if (error) return NextResponse.json({ error: error.message.includes("outside_business_hours") ? "営業時間内の枠を指定してください。" : "指定した枠は予約できません。" }, { status: 409 });
    return NextResponse.json({ reservation: data }, { status: 201 });
  } catch { return NextResponse.json({ error: "予約を登録できませんでした。" }, { status: 500 }); }
}
