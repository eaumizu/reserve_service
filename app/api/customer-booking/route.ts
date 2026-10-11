import {dispatchLineReservationEvents,LINE_EVENT_WARNING} from "../../../lib/line-reservation-events";
export const maxDuration=30;
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../lib/supabase-server";
import { CUSTOMER_TOKEN, CUSTOMER_HEADERS, hashCustomerToken, type CustomerBooking } from "../../../lib/customer-booking";
import { adminAvailableStarts, isBookingDate } from "../../../lib/reservations/admin-availability";
import { readBookingRules } from "../../../lib/booking-rules-server";
import { acceptsWebBooking, bookingDateBounds } from "../../../lib/booking-rules";
import { isGridTimestamp } from "../../../lib/reservations/time-grid";
const respond = (value: unknown, status=200) => NextResponse.json(value,{status,headers:CUSTOMER_HEADERS});
export async function POST(request: NextRequest) {
  try {
    let body;
    try { body=await request.json(); } catch { return respond({error:"入力内容を確認してください。"},400); }
    if (!body || typeof body.token!=="string" || !CUSTOMER_TOKEN.test(body.token)) return respond({error:"予約リンクが無効です。店舗にお問い合わせください。"},404);
    const hash=hashCustomerToken(body.token), db=supabaseServer();
    const found=await db.rpc("read_customer_booking",{p_token_hash:hash});
    if (found.error) {
      if (found.error.message.includes("booking_not_found")) return respond({error:"予約リンクが無効または期限切れです。店舗にお問い合わせください。"},404);
      throw found.error;
    }
    const booking=found.data as CustomerBooking;
    if (body.action==="view") {
      const rules=await readBookingRules(booking.storeId);
      return respond({booking,bounds:bookingDateBounds(rules)});
    }
    if (body.action==="slots") {
      if (!booking.canManage) return respond({error:"この予約は変更できません。店舗にお問い合わせください。"},409);
      if (typeof body.date!=="string" || !isBookingDate(body.date)) return respond({error:"正しい日付を選択してください。"},400);
      const rules=await readBookingRules(booking.storeId), bounds=bookingDateBounds(rules);
      if (body.date<bounds.minDate || body.date>bounds.maxDate) return respond({slots:[]});
      const slots=await adminAvailableStarts(booking.storeId,booking.serviceId,booking.staffId,body.date,booking.id);
      return respond({slots:(slots??[]).filter(start=>acceptsWebBooking(start,rules))});
    }
    if (!["cancel","reschedule"].includes(body.action) || typeof body.expectedUpdatedAt!=="string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(body.expectedUpdatedAt) ||
      !Number.isFinite(Date.parse(body.expectedUpdatedAt))) return respond({error:"予約を再読み込みしてください。"},400);
    if (body.action==="reschedule" && (typeof body.startAt!=="string" || !isGridTimestamp(body.startAt))) return respond({error:"空き枠から日時を選んでください。"},400);
    const result=await db.rpc("manage_customer_booking_atomic",{p_token_hash:hash,p_action:body.action,
      p_expected_updated_at:body.expectedUpdatedAt,p_start_at:body.action==="reschedule"?body.startAt:null});
    if (result.error) {
      if (result.error.message.includes("booking_not_found")) return respond({error:"予約リンクが無効です。店舗にお問い合わせください。"},404);
      if (["booking_changed","reservation_changed","booking_closed","booking_window_closed","time_slot_unavailable","outside_business_hours","invalid_staff_service"].some(code=>result.error!.message.includes(code)))
        return respond({error:"予約の状態や空き枠が変わったか、受付期限を過ぎました。予約を再読み込みしてください。"},409);
      throw result.error;
    }
    const notification=await dispatchLineReservationEvents(booking.storeId,booking.id);
    return respond({booking:result.data,notificationWarning:notification.pending?"予約の操作は完了しました。LINE通知は未送信のため、店舗へお問い合わせください。":null});
  } catch { return respond({error:"予約の確認・操作ができませんでした。操作後の通信エラーでは、再読み込みして結果をご確認ください。"},503); }
}
