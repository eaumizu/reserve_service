import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../lib/supabase-server";
import type { ReservationInput } from "../../../lib/reservations/types";
import { isGridTimestamp } from "../../../lib/reservations/time-grid";
import { readBookingRules } from "../../../lib/booking-rules-server";
import { acceptsWebBooking } from "../../../lib/booking-rules";
export async function POST(request: NextRequest) {
  try { const body = await request.json() as ReservationInput; const storeId = process.env.NEXT_PUBLIC_DEFAULT_STORE_ID!;
    if (body.source !== "web" || body.storeId !== storeId || !body.customerName?.trim() || !body.customerPhone?.trim() || !body.startAt) return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400 });
    if (!isGridTimestamp(body.startAt)) return NextResponse.json({ error: "開始時間は15分刻みの空き枠から選択してください。" }, { status: 400 });
    if (!acceptsWebBooking(body.startAt, await readBookingRules(storeId))) return NextResponse.json({ error: "予約受付期間または締め切りを過ぎています。別の空き枠を選択してください。" }, { status: 409 });
    const { data, error } = await supabaseServer().rpc("create_reservation_atomic", { p_store_id: storeId, p_service_id: body.serviceId, p_staff_id: body.staffId, p_start_at: body.startAt, p_customer_name: body.customerName.trim(), p_customer_phone: body.customerPhone.trim(), p_source: body.source, p_note: body.note ?? null });
    if (error) return NextResponse.json({ error: error.message.includes("booking_window_closed") ? "受付を締め切りました。別の空き枠を選択してください。" : error.message.includes("time_slot_unavailable") ? "その枠は先に予約されました。もう一度お選びください。" : error.message.includes("outside_business_hours") ? "営業時間内の枠を選択してください。" : "予約を確定できませんでした。" }, { status: 409 });
    return NextResponse.json({ reservation: data }, { status: 201 });
  } catch { return NextResponse.json({ error: "予約を確定できませんでした。" }, { status: 500 }); }
}
