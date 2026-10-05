import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import type { ReservationInput } from "@/lib/reservations/types";

/** Staff-only endpoint for phone, walk-in, and admin entries. UI login is the next V1 increment. */
export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
    if (!token) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const { data: { user } } = await auth.auth.getUser(token);
    const metadata = user?.app_metadata as { store_id?: string; role?: string } | undefined;
    const body = await request.json() as ReservationInput;
    if (!user || !metadata?.store_id || !["staff", "admin"].includes(metadata.role ?? "") || !["phone", "walk_in", "admin"].includes(body.source) || body.storeId !== metadata.store_id) return NextResponse.json({ error: "この操作は許可されていません。" }, { status: 403 });
    const { data, error } = await supabaseServer().rpc("create_reservation_atomic", { p_store_id: body.storeId, p_service_id: body.serviceId, p_staff_id: body.staffId, p_start_at: body.startAt, p_customer_name: body.customerName.trim(), p_customer_phone: body.customerPhone.trim(), p_source: body.source, p_note: body.note ?? null });
    if (error) return NextResponse.json({ error: "指定した枠は予約できません。" }, { status: 409 });
    return NextResponse.json({ reservation: data }, { status: 201 });
  } catch { return NextResponse.json({ error: "予約を登録できませんでした。" }, { status: 500 }); }
}
