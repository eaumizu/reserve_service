import {emailBookingTokenCipher,dispatchEmailBookingEvents,EMAIL_EVENT_WARNING} from "../../../lib/email-booking-events";
export const maxDuration=60;
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../lib/supabase-server";
import type { ReservationInput } from "../../../lib/reservations/types";
import { isGridTimestamp } from "../../../lib/reservations/time-grid";
import { readBookingRules } from "../../../lib/booking-rules-server";
import { acceptsWebBooking } from "../../../lib/booking-rules";
import { parseCustomerEmail } from "../../../lib/reservations/email";
import { createCustomerToken,hashCustomerToken,customerManagementPath } from "../../../lib/customer-booking";
export async function POST(request: NextRequest) {
  try { const body = await request.json() as ReservationInput; const storeId = process.env.NEXT_PUBLIC_DEFAULT_STORE_ID!;
    if (body.source !== "web" || body.storeId !== storeId || !body.customerName?.trim() || !body.customerPhone?.trim() || !body.startAt) return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400 });
    const email = parseCustomerEmail(body.customerEmail);
    if (email === undefined) return NextResponse.json({ error: "メールアドレスを確認してください。" }, { status: 400 });
    if (!isGridTimestamp(body.startAt)) return NextResponse.json({ error: "開始時間は15分刻みの空き枠から選択してください。" }, { status: 400 });
    if (!acceptsWebBooking(body.startAt, await readBookingRules(storeId))) return NextResponse.json({ error: "予約受付期間または締め切りを過ぎています。別の空き枠を選択してください。" }, { status: 409 });
    const token=createCustomerToken();
    const db=supabaseServer();
    const tokenCipher=emailBookingTokenCipher(storeId,token,email);
    let result=await db.rpc("create_customer_booking_atomic",{p_store_id:storeId,p_service_id:body.serviceId,p_staff_id:body.staffId,
      p_start_at:body.startAt,p_customer_name:body.customerName.trim(),p_customer_phone:body.customerPhone.trim(),p_source:body.source,
      p_note:body.note??null,p_customer_email:email,p_token_hash:hashCustomerToken(token),...(tokenCipher?{p_token_cipher:tokenCipher}:{})});
    let managePath: string|null=customerManagementPath(token);
    // Missing new RPC means no write occurred. Preserve booking during migration rollout.
    if(result.error?.code==="PGRST202"&&tokenCipher){
      result=await db.rpc("create_customer_booking_atomic",{p_store_id:storeId,p_service_id:body.serviceId,p_staff_id:body.staffId,p_start_at:body.startAt,p_customer_name:body.customerName.trim(),p_customer_phone:body.customerPhone.trim(),p_source:body.source,p_note:body.note??null,p_customer_email:email,p_token_hash:hashCustomerToken(token)});
    }
    if(result.error?.code==="PGRST202"){
      managePath=null;
      result = await db.rpc(email ? "create_reservation_with_email_atomic" : "create_reservation_atomic", { ...(email ? { p_customer_email: email } : {}), p_store_id: storeId, p_service_id: body.serviceId, p_staff_id: body.staffId, p_start_at: body.startAt, p_customer_name: body.customerName.trim(), p_customer_phone: body.customerPhone.trim(), p_source: body.source, p_note: body.note ?? null });

    }
    const {data,error}=result;
    if (email && error?.code === "PGRST202") return NextResponse.json({ error: "メール連絡先の保存準備中です。時間をおいて再度お試しください。" }, { status: 503 });
    if (error) return NextResponse.json({ error: error.message.includes("booking_window_closed") ? "受付を締め切りました。別の空き枠を選択してください。" : error.message.includes("time_slot_unavailable") ? "その枠は先に予約されました。もう一度お選びください。" : error.message.includes("outside_business_hours") ? "営業時間内の枠を選択してください。" : "予約を確定できませんでした。" }, { status: 409 });
    const notification=email?await dispatchEmailBookingEvents(storeId,data.id):{pending:false};
    return NextResponse.json({ reservation: data, managePath,notificationWarning:notification.pending?EMAIL_EVENT_WARNING:null }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "予約を確定できませんでした。" }, { status: 500 }); }
}
